import { useMemo, useState, useRef, useCallback } from 'react';
import type { ActivityItem, Matter, Provider } from '@/types';
import {
  timestampToMinutes,
  minutesBetween,
  formatMinutes,
  formatTime,
  formatTimeRange,
  parseHHmm,
} from '@/lib/time';
import {
  Calendar,
  Mail,
  FileText,
  Inbox,
  Globe,
  Layers,
  CheckCircle2,
} from 'lucide-react';

// ── Column definitions ────────────────────────────────────────────────────

export type ColumnKey =
  | 'calendar'
  | 'email_sent'
  | 'sc_doc'
  | 'sc_other'
  | 'browser'
  | 'other';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  icon: typeof Calendar;
  color: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'calendar', label: 'Calendar', icon: Calendar, color: '#dc2626' },
  { key: 'email_sent', label: 'Sent Emails', icon: Mail, color: '#2563eb' },
  { key: 'sc_doc', label: 'SC Documents', icon: FileText, color: '#0891b2' },
  { key: 'sc_other', label: 'SC Other', icon: Inbox, color: '#0e7490' },
  { key: 'browser', label: 'Browser', icon: Globe, color: '#0d9488' },
  { key: 'other', label: 'Other', icon: Layers, color: '#78716c' },
];

function itemColumn(item: ActivityItem): ColumnKey {
  if (item.provider === 'calendar') return 'calendar';
  if (item.provider === 'email') {
    return item.meta.direction === 'outgoing' ? 'email_sent' : 'other';
  }
  if (item.provider === 'singlecase') {
    if (item.meta.scActivityKind === 'document') return 'sc_doc';
    return 'sc_other';
  }
  if (item.provider === 'browser') return 'browser';
  return 'other';
}

// ── Aggregation for SC Other and Browser ───────────────────────────────────

interface AggregatedGroup {
  key: string;
  label: string;
  subLabel: string;
  itemCount: number;
  startMin: number;
  endMin: number;
  totalMinutes: number;
  itemIds: string[];
  caseId?: string;
  caseName?: string;
}

function aggregateScOther(items: ActivityItem[], timezone?: string): AggregatedGroup[] {
  const byCase = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const caseKey = item.meta.caseId ?? '__no_case';
    const list = byCase.get(caseKey) ?? [];
    list.push(item);
    byCase.set(caseKey, list);
  }
  const groups: AggregatedGroup[] = [];
  for (const [caseKey, caseItems] of byCase) {
    caseItems.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const startMin = timestampToMinutes(caseItems[0].timestamp, timezone);
    const last = caseItems[caseItems.length - 1];
    const endMin = last.endTimestamp
      ? timestampToMinutes(last.endTimestamp, timezone)
      : startMin + (last.durationMinutes ?? 15);
    const totalMinutes = caseItems.reduce(
      (s, i) => s + (i.endTimestamp
        ? minutesBetween(i.timestamp, i.endTimestamp, timezone)
        : i.durationMinutes ?? 15),
      0,
    );
    groups.push({
      key: `sc-other-${caseKey}`,
      label: caseItems[0].meta.caseName ?? caseItems[0].meta.caseIdVisible ?? 'SingleCase',
      subLabel: `${caseItems.length} ${caseItems.length === 1 ? 'action' : 'actions'} · ${formatMinutes(totalMinutes)}`,
      itemCount: caseItems.length,
      startMin,
      endMin: Math.max(endMin, startMin + 30),
      totalMinutes,
      itemIds: caseItems.map((i) => i.id),
      caseId: caseItems[0].meta.caseId,
      caseName: caseItems[0].meta.caseName,
    });
  }
  return groups.sort((a, b) => a.startMin - b.startMin);
}

function aggregateBrowser(items: ActivityItem[], timezone?: string): AggregatedGroup[] {
  const BLOCK_SIZE = 120;
  const byBlock = new Map<number, ActivityItem[]>();
  for (const item of items) {
    const startMin = timestampToMinutes(item.timestamp, timezone);
    const blockStart = Math.floor(startMin / BLOCK_SIZE) * BLOCK_SIZE;
    const list = byBlock.get(blockStart) ?? [];
    list.push(item);
    byBlock.set(blockStart, list);
  }
  const groups: AggregatedGroup[] = [];
  for (const [blockStart, blockItems] of byBlock) {
    blockItems.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const totalMinutes = blockItems.reduce(
      (s, i) => s + (i.endTimestamp
        ? minutesBetween(i.timestamp, i.endTimestamp, timezone)
        : i.durationMinutes ?? 0),
      0,
    );
    const domains = new Set(blockItems.map((i) => i.meta.fileName ?? i.summary));
    const topDomains = Array.from(domains).slice(0, 3);
    const blockEnd = blockStart + BLOCK_SIZE;
    groups.push({
      key: `browser-${blockStart}`,
      label: topDomains.length > 0 ? topDomains.join(', ') : 'Browsing',
      subLabel: `${blockItems.length} ${blockItems.length === 1 ? 'site' : 'sites'} · ${formatMinutes(totalMinutes)}`,
      itemCount: blockItems.length,
      startMin: blockStart,
      endMin: Math.min(blockEnd, blockStart + Math.max(totalMinutes, 30)),
      totalMinutes,
      itemIds: blockItems.map((i) => i.id),
    });
  }
  return groups.sort((a, b) => a.startMin - b.startMin);
}

// ── Lane assignment for overlap stacking ────────────────────────────────────

interface PlacedBlock {
  key: string;
  label: string;
  subLabel: string;
  startMin: number;
  endMin: number;
  lane: number;
  laneCount: number;
  color: string;
  itemIds: string[];
  isAggregate: boolean;
  caseId?: string;
  caseName?: string;
  isUsed?: boolean;
  isInTimesheet?: boolean;
  originalItem?: ActivityItem;
  column: ColumnKey;
}

function assignLanes(blocks: { startMin: number; endMin: number; key: string }[]): { lane: number; laneCount: number }[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  const result: { lane: number; laneCount: number }[] = [];
  for (const block of sorted) {
    let lane = laneEnds.findIndex((end) => end <= block.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.endMin;
    result.push({ lane, laneCount: 0 });
  }
  const laneCount = Math.max(laneEnds.length, 1);
  return result.map((r) => ({ ...r, laneCount }));
}

// ── Component ──────────────────────────────────────────────────────────────

interface CalendarBoardProps {
  items: ActivityItem[];
  matters: Matter[];
  timezone?: string;
  workStart: string;
  workEnd: string;
  usedItemIds: Set<string>;
  generatedItemIds: Set<string>;
  highlightedItemIds: Set<string>;
  manualOverrides: Map<string, string | null>;
  onAssign: (itemId: string, matterId: string) => void;
  onDropGroup: (itemIds: string[], matterId: string) => void;
  onHoverEntry: (itemIds: string[] | null) => void;
  onConnectGroup: (itemIds: string[]) => void;
}

const MIN_BLOCK_PX = 24;
const MIN_DURATION_MIN = 15;
const MIN_HOUR_PX = 28;
const MAX_HOUR_PX = 240;
const DEFAULT_HOUR_PX = 56;

export function CalendarBoard({
  items,
  matters,
  timezone,
  workStart,
  workEnd,
  usedItemIds,
  generatedItemIds,
  highlightedItemIds,
  manualOverrides,
  onAssign: _onAssign,
  onDropGroup,
  onHoverEntry,
  onConnectGroup: _onConnectGroup,
}: CalendarBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl + scroll to zoom the calendar time scale
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    setHourPx((prev) => {
      const next = Math.round(prev + (e.deltaY < 0 ? 8 : -8));
      return Math.max(MIN_HOUR_PX, Math.min(MAX_HOUR_PX, next));
    });
  }, []);

  const startMin = parseHHmm(workStart);
  const endMin = Math.max(parseHHmm(workEnd), startMin + 60);
  const displayStart = Math.floor(startMin / 60) * 60;
  const displayEnd = Math.ceil(endMin / 60) * 60;
  const totalPx = ((displayEnd - displayStart) / 60) * hourPx + 8;

  // Build column data
  const columns = useMemo(() => {
    const result: Record<ColumnKey, PlacedBlock[]> = {
      calendar: [],
      email_sent: [],
      sc_doc: [],
      sc_other: [],
      browser: [],
      other: [],
    };

    for (const colDef of COLUMNS) {
      const colItems = items.filter((i) => itemColumn(i) === colDef.key);

      if (colDef.key === 'sc_other') {
        const groups = aggregateScOther(colItems, timezone);
        const laneAssignments = assignLanes(groups);
        result.sc_other = groups.map((g, i) => ({
          key: g.key,
          label: g.label,
          subLabel: g.subLabel,
          startMin: g.startMin,
          endMin: g.endMin,
          lane: laneAssignments[i].lane,
          laneCount: laneAssignments[i].laneCount,
          color: colDef.color,
          itemIds: g.itemIds,
          isAggregate: true,
          caseId: g.caseId,
          caseName: g.caseName,
          column: colDef.key,
          isUsed: g.itemIds.every((id) => usedItemIds.has(id)),
          isInTimesheet: g.itemIds.some((id) => generatedItemIds.has(id)),
        }));
        continue;
      }

      if (colDef.key === 'browser') {
        const groups = aggregateBrowser(colItems, timezone);
        const laneAssignments = assignLanes(groups);
        result.browser = groups.map((g, i) => ({
          key: g.key,
          label: g.label,
          subLabel: g.subLabel,
          startMin: g.startMin,
          endMin: g.endMin,
          lane: laneAssignments[i].lane,
          laneCount: laneAssignments[i].laneCount,
          color: colDef.color,
          itemIds: g.itemIds,
          isAggregate: true,
          column: colDef.key,
          isUsed: g.itemIds.every((id) => usedItemIds.has(id)),
          isInTimesheet: g.itemIds.some((id) => generatedItemIds.has(id)),
        }));
        continue;
      }

      const blockItems = colItems.map((item) => {
        const sMin = timestampToMinutes(item.timestamp, timezone);
        const eMin = item.endTimestamp
          ? timestampToMinutes(item.endTimestamp, timezone)
          : sMin + (item.durationMinutes ?? 15);
        const duration = eMin - sMin;
        const visualEnd = duration < MIN_DURATION_MIN ? sMin + MIN_DURATION_MIN : eMin;
        return { item, startMin: sMin, endMin: visualEnd, key: item.id };
      });

      const laneAssignments = assignLanes(blockItems);
      result[colDef.key] = blockItems.map((b, i) => ({
        key: b.key,
        label: b.item.meta.subject ?? b.item.meta.title ?? b.item.meta.fileName ?? b.item.summary,
        subLabel: b.item.endTimestamp
          ? formatTimeRange(b.item.timestamp, b.item.endTimestamp, timezone)
          : formatTime(b.item.timestamp, timezone),
        startMin: b.startMin,
        endMin: b.endMin,
        lane: laneAssignments[i].lane,
        laneCount: laneAssignments[i].laneCount,
        color: colDef.color,
        itemIds: [b.item.id],
        isAggregate: false,
        originalItem: b.item,
        column: colDef.key,
        isUsed: usedItemIds.has(b.item.id),
        isInTimesheet: generatedItemIds.has(b.item.id),
      }));
    }

    return result;
  }, [items, timezone, usedItemIds, generatedItemIds]);

  // All blocks flat
  const allBlocks = useMemo(() => {
    return COLUMNS.flatMap((c) => columns[c.key]);
  }, [columns]);

  // Get all item IDs to drag when dragging a block
  const getDragGroupIds = useCallback((block: PlacedBlock): string[] => {
    return block.itemIds;
  }, []);

  // Hour markers
  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = displayStart / 60; h < displayEnd / 60; h++) {
      arr.push(h);
    }
    return arr;
  }, [displayStart, displayEnd]);

  // Recent matters as buckets
  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, block: PlacedBlock) => {
    const groupIds = getDragGroupIds(block);
    const payload = JSON.stringify(groupIds);
    e.dataTransfer.setData('text/daykeeper-items', payload);
    e.dataTransfer.setData('text/daykeeper-item', block.itemIds[0]);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(block.key);
  }, [getDragGroupIds]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);



  // Render a single block
  function renderBlock(block: PlacedBlock) {
    const topPx = ((block.startMin - displayStart) / 60) * hourPx;
    const heightPx = Math.max(MIN_BLOCK_PX, ((block.endMin - block.startMin) / 60) * hourPx);
    // Highlight from timesheet preview hover
    const isPreviewHighlighted = highlightedItemIds.size > 0 && block.itemIds.some((id) => highlightedItemIds.has(id));
    const isPreviewDimmed = highlightedItemIds.size > 0 && !isPreviewHighlighted;
    const isHovered = hoveredBlock === block.key;
    const width = Math.max(60, 100 / block.laneCount - 3);
    const left = (block.lane * 100) / block.laneCount + 1.5;

    return (
      <div
        key={block.key}
        draggable
        onDragStart={(e) => handleDragStart(e, block)}
        onDragEnd={handleDragEnd}
        onMouseEnter={() => {
          setHoveredBlock(block.key);
        }}
        onMouseLeave={() => {
          setHoveredBlock(null);
        }}
        className={`group absolute cursor-grab overflow-hidden rounded-md border text-left transition-all duration-150 ${
          isPreviewDimmed ? 'opacity-20' : ''
        } ${isPreviewHighlighted ? 'ring-2 ring-accent-400 ring-offset-1' : ''} ${
          draggingId === block.key ? 'opacity-40' : ''
        } ${isHovered ? 'shadow-md z-10' : ''}`}
        style={{
          top: topPx,
          height: heightPx,
          left: `${left}%`,
          width: `${width}%`,
          borderColor: block.color,
          backgroundColor: block.isInTimesheet ? `${block.color}55` : `${block.color}18`,
        }}
        title={`${block.label} · ${block.subLabel}${block.isUsed ? ' · Used' : ''}${block.isInTimesheet ? ' · In timesheet' : ''}`}
      >
        <div className="h-full border-l-[3px] px-1.5 py-1" style={{ borderColor: block.color }}>
          {heightPx >= 20 && (
            <p className="truncate text-[10px] font-medium leading-tight text-stone-700">
              {block.label}
            </p>
          )}
          {heightPx >= 34 && (
            <p className="truncate text-[9px] leading-tight text-stone-500">
              {block.subLabel}
            </p>
          )}
          {block.isAggregate && heightPx >= 40 && (
            <span className="mt-0.5 inline-block rounded bg-stone-200/70 px-1 text-[8px] font-semibold text-stone-600">
              {block.itemIds.length} signals
            </span>
          )}
          {(() => {
            const matterId = block.itemIds.map((id) => manualOverrides.get(id)).find((v) => v !== undefined && v !== null);
            if (!matterId) return null;
            const matter = matters.find((m) => m.id === matterId);
            if (!matter) return null;
            return (
              <span className="mt-0.5 inline-block max-w-full truncate rounded bg-blue-100/80 px-1 text-[8px] font-semibold text-blue-700">
                {matter.case_id_visible ?? matter.name}
              </span>
            );
          })()}
          {block.isUsed && (
            <CheckCircle2 size={10} className="absolute right-1 top-1 text-emerald-600" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Calendar board — scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div ref={boardRef} className="relative flex gap-0" style={{ minHeight: totalPx + 40 }}>
          {/* Time gutter */}
          <div className="sticky left-0 z-20 w-12 shrink-0 bg-stone-50/80 backdrop-blur-sm">
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-t border-stone-100 text-right"
                style={{ height: hourPx }}
              >
                <span className="absolute -top-1.5 right-1.5 rounded bg-white px-0.5 text-[9px] font-medium text-stone-400">
                  {String(h % 24).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Columns */}
          {COLUMNS.map((colDef) => {
            const colBlocks = columns[colDef.key];
            const Icon = colDef.icon;
            return (
              <div key={colDef.key} className="relative flex-1 border-l border-stone-200">
                {/* Column header */}
                <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-stone-200 bg-stone-50/90 px-2 py-1.5 backdrop-blur-sm">
                  <Icon size={12} style={{ color: colDef.color }} />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                    {colDef.label}
                  </span>
                  <span className="ml-auto text-[9px] text-stone-400">
                    {colBlocks.length}
                  </span>
                </div>

                {/* Hour grid lines */}
                <div className="relative" style={{ height: totalPx }}>
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-stone-100"
                      style={{ top: ((h * 60 - displayStart) / 60) * hourPx }}
                    />
                  ))}

                  {/* Blocks */}
                  {colBlocks.map((block) => renderBlock(block))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];
