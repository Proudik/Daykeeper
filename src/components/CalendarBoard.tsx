import { useMemo, useState, useRef, useCallback } from 'react';
import type { ActivityItem, Matter } from '@/types';
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
  Briefcase,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────

const MIN_BLOCK_PX = 28;
const MIN_HOUR_PX = 28;
const MAX_HOUR_PX = 240;
const DEFAULT_HOUR_PX = 56;
const COLLAPSED_BAND_PX = 24;
const MIN_GAP_FOR_COLLAPSE = 30;   // minutes — gaps >= this collapse
const OVERLAP_TOLERANCE_MIN = 5;    // minutes — items starting within this of another ending "overlap"
const MAX_LANES = 2;                // max side-by-side before stacking
const GROUP_PROXIMITY_MIN = 20;     // minutes — max gap between consecutive items to be grouped
const GROUP_MIN_ITEMS = 3;          // minimum items to form a group
const MIN_DURATION_MIN = 5;         // minimum visual time range for a block
const EXPANDED_ITEM_PX = 20;        // height per signal row inside an expanded card
const EXPANDED_HEADER_PX = 32;      // header + padding inside an expanded card

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

// ── Types ─────────────────────────────────────────────────────────────────

interface SignalGroup {
  key: string;
  label: string;
  subLabel: string;
  itemCount: number;
  startMin: number;
  endMin: number;
  totalMinutes: number;
  itemIds: string[];
  items: ActivityItem[];
  caseId?: string;
  caseName?: string;
  isGrouped: boolean;
}

interface PlacedBlock extends SignalGroup {
  color: string;
  column: ColumnKey;
  isUsed: boolean;
  isInTimesheet: boolean;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
}

interface TimeSegment {
  start: number;
  end: number;
}

interface TimeScale {
  minuteToPx: (min: number) => number;
  totalPx: number;
  gaps: { start: number; end: number; topPx: number }[];
  hourMarkers: { hour: number; topPx: number }[];
}

// ── Time helpers ───────────────────────────────────────────────────────────

function itemStartMin(item: ActivityItem, tz?: string): number {
  return timestampToMinutes(item.timestamp, tz);
}

function itemEndMin(item: ActivityItem, tz?: string): number {
  return item.endTimestamp
    ? timestampToMinutes(item.endTimestamp, tz)
    : itemStartMin(item, tz) + (item.durationMinutes ?? 5);
}

function itemDuration(item: ActivityItem, tz?: string): number {
  return item.endTimestamp
    ? minutesBetween(item.timestamp, item.endTimestamp, tz)
    : item.durationMinutes ?? 5;
}

// ── Grouping ───────────────────────────────────────────────────────────────

function groupItems(items: ActivityItem[], timezone?: string): SignalGroup[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Cluster by time proximity
  const clusters: ActivityItem[][] = [];
  let cur: ActivityItem[] = [sorted[0]];
  let curEnd = itemEndMin(sorted[0], timezone);
  for (let i = 1; i < sorted.length; i++) {
    const s = itemStartMin(sorted[i], timezone);
    if (s - curEnd <= GROUP_PROXIMITY_MIN) {
      cur.push(sorted[i]);
      curEnd = Math.max(curEnd, itemEndMin(sorted[i], timezone));
    } else {
      clusters.push(cur);
      cur = [sorted[i]];
      curEnd = itemEndMin(sorted[i], timezone);
    }
  }
  clusters.push(cur);

  const groups: SignalGroup[] = [];
  for (const cluster of clusters) {
    // For SC items, sub-group by caseId within the time cluster
    const hasCase = cluster.some((i) => i.meta.caseId);
    if (hasCase) {
      const byCase = new Map<string, ActivityItem[]>();
      for (const item of cluster) {
        const k = item.meta.caseId ?? '__no_case';
        const l = byCase.get(k) ?? [];
        l.push(item);
        byCase.set(k, l);
      }
      for (const [caseKey, caseItems] of byCase) {
        if (caseItems.length >= GROUP_MIN_ITEMS) {
          groups.push(makeGroup(caseItems, timezone, `case-${caseKey}-${cluster[0].id}`));
        } else {
          for (const item of caseItems) groups.push(makeSingle(item, timezone));
        }
      }
    } else if (cluster.length >= GROUP_MIN_ITEMS) {
      groups.push(makeGroup(cluster, timezone, `prox-${cluster[0].id}`));
    } else {
      for (const item of cluster) groups.push(makeSingle(item, timezone));
    }
  }
  return groups.sort((a, b) => a.startMin - b.startMin);
}

function makeGroup(items: ActivityItem[], tz: string | undefined, key: string): SignalGroup {
  const sorted = [...items].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const startMin = itemStartMin(sorted[0], tz);
  const endMin = itemEndMin(sorted[sorted.length - 1], tz);
  const totalMinutes = sorted.reduce((s, i) => s + itemDuration(i, tz), 0);
  const label =
    sorted[0].meta.caseName ??
    sorted[0].meta.caseIdVisible ??
    sorted[0].meta.subject ??
    sorted[0].meta.title ??
    sorted[0].summary;
  const siteCount = new Set(sorted.map((i) => i.meta.fileName ?? i.summary)).size;
  const subLabel =
    sorted[0].provider === 'browser'
      ? `${siteCount} ${siteCount === 1 ? 'site' : 'sites'} · ${sorted.length} ${sorted.length === 1 ? 'signal' : 'signals'} · ${formatMinutes(totalMinutes)}`
      : `${sorted.length} ${sorted.length === 1 ? 'signal' : 'signals'} · ${formatMinutes(totalMinutes)}`;
  return {
    key,
    label,
    subLabel,
    itemCount: sorted.length,
    startMin,
    endMin: Math.max(endMin, startMin + 15),
    totalMinutes,
    itemIds: sorted.map((i) => i.id),
    items: sorted,
    caseId: sorted[0].meta.caseId,
    caseName: sorted[0].meta.caseName,
    isGrouped: true,
  };
}

function makeSingle(item: ActivityItem, tz: string | undefined): SignalGroup {
  const startMin = itemStartMin(item, tz);
  const endMin = Math.max(itemEndMin(item, tz), startMin + MIN_DURATION_MIN);
  return {
    key: item.id,
    label: item.meta.subject ?? item.meta.title ?? item.meta.fileName ?? item.summary,
    subLabel: item.endTimestamp
      ? formatTimeRange(item.timestamp, item.endTimestamp, tz)
      : formatTime(item.timestamp, tz),
    itemCount: 1,
    startMin,
    endMin,
    totalMinutes: itemDuration(item, tz),
    itemIds: [item.id],
    items: [item],
    isGrouped: false,
  };
}

// ── Time scale (non-linear with collapsed gaps) ────────────────────────────

function computeActiveSegments(
  allGroups: SignalGroup[][],
  displayStart: number,
  displayEnd: number,
): TimeSegment[] {
  const ranges: TimeSegment[] = [];
  for (const groups of allGroups) {
    for (const g of groups) {
      const s = Math.max(g.startMin, displayStart);
      const e = Math.min(g.endMin, displayEnd);
      if (s < e) ranges.push({ start: s, end: e });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.length === 0) return [];

  const merged: TimeSegment[] = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start - last.end <= MIN_GAP_FOR_COLLAPSE) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push({ ...ranges[i] });
    }
  }
  return merged;
}

function buildTimeScale(
  segments: TimeSegment[],
  displayStart: number,
  displayEnd: number,
  hourPx: number,
): TimeScale {
  let px = 0;
  const gaps: { start: number; end: number; topPx: number }[] = [];
  const segmentOffsets: { start: number; end: number; topPx: number }[] = [];
  let prevEnd = displayStart;

  for (const seg of segments) {
    const gap = seg.start - prevEnd;
    if (gap > 0) {
      gaps.push({ start: prevEnd, end: seg.start, topPx: px });
      px += COLLAPSED_BAND_PX;
    }
    segmentOffsets.push({ start: seg.start, end: seg.end, topPx: px });
    px += ((seg.end - seg.start) / 60) * hourPx;
    prevEnd = seg.end;
  }
  if (prevEnd < displayEnd) {
    gaps.push({ start: prevEnd, end: displayEnd, topPx: px });
    px += COLLAPSED_BAND_PX;
  }

  const minuteToPx = (min: number): number => {
    for (const seg of segmentOffsets) {
      if (min < seg.start) return seg.topPx;
      if (min <= seg.end) return seg.topPx + ((min - seg.start) / 60) * hourPx;
    }
    return px;
  };

  const hourMarkers: { hour: number; topPx: number }[] = [];
  for (const seg of segmentOffsets) {
    const firstHour = Math.ceil(seg.start / 60);
    const lastHour = Math.floor(seg.end / 60);
    for (let h = firstHour; h <= lastHour; h++) {
      const m = h * 60;
      if (m >= seg.start && m <= seg.end) {
        hourMarkers.push({ hour: h, topPx: seg.topPx + ((m - seg.start) / 60) * hourPx });
      }
    }
  }

  return { minuteToPx, totalPx: px, gaps, hourMarkers };
}

// ── Layout (lane splitting + stacking with push-down) ──────────────────────

function computeOverlapGroups(groups: SignalGroup[]): SignalGroup[][] {
  const sorted = [...groups].sort((a, b) => a.startMin - b.startMin);
  if (sorted.length === 0) return [];
  const result: SignalGroup[][] = [];
  let cur: SignalGroup[] = [sorted[0]];
  let curEnd = sorted[0].endMin;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMin - curEnd <= OVERLAP_TOLERANCE_MIN) {
      cur.push(sorted[i]);
      curEnd = Math.max(curEnd, sorted[i].endMin);
    } else {
      result.push(cur);
      cur = [sorted[i]];
      curEnd = sorted[i].endMin;
    }
  }
  result.push(cur);
  return result;
}

function blockHeight(
  g: SignalGroup,
  ts: TimeScale,
  expandedGroups: Set<string>,
): number {
  const durPx = Math.max(MIN_BLOCK_PX, ts.minuteToPx(g.endMin) - ts.minuteToPx(g.startMin));
  const expPx =
    g.isGrouped && expandedGroups.has(g.key)
      ? g.items.length * EXPANDED_ITEM_PX + EXPANDED_HEADER_PX
      : 0;
  return Math.max(durPx, expPx);
}

function layoutColumn(
  groups: SignalGroup[],
  ts: TimeScale,
  expandedGroups: Set<string>,
  color: string,
  column: ColumnKey,
  usedItemIds: Set<string>,
  generatedItemIds: Set<string>,
): PlacedBlock[] {
  if (groups.length === 0) return [];
  const overlapGroups = computeOverlapGroups(groups);
  const blocks: PlacedBlock[] = [];
  const laneBottoms: number[] = [0, 0];

  for (const og of overlapGroups) {
    if (og.length <= MAX_LANES) {
      // Split into lanes (1 = full width, 2 = side by side)
      for (let i = 0; i < og.length; i++) {
        const g = og[i];
        const trueTop = ts.minuteToPx(g.startMin);
        const top = Math.max(trueTop, laneBottoms[i]);
        const height = blockHeight(g, ts, expandedGroups);
        laneBottoms[i] = top + height;
        blocks.push({
          ...g,
          color,
          column,
          isUsed: g.itemIds.every((id) => usedItemIds.has(id)),
          isInTimesheet: g.itemIds.some((id) => generatedItemIds.has(id)),
          topPx: top,
          heightPx: height,
          leftPct: og.length === 1 ? 0 : (i * 100) / og.length + 1,
          widthPct: og.length === 1 ? 100 : 100 / og.length - 2,
        });
      }
    } else {
      // Stack vertically — all full width, in start order
      let prevBottom = laneBottoms[0];
      for (const g of og) {
        const trueTop = ts.minuteToPx(g.startMin);
        const top = Math.max(trueTop, prevBottom);
        const height = blockHeight(g, ts, expandedGroups);
        prevBottom = top + height;
        laneBottoms[0] = prevBottom;
        blocks.push({
          ...g,
          color,
          column,
          isUsed: g.itemIds.every((id) => usedItemIds.has(id)),
          isInTimesheet: g.itemIds.some((id) => generatedItemIds.has(id)),
          topPx: top,
          heightPx: height,
          leftPct: 0,
          widthPct: 100,
        });
      }
    }
  }
  return blocks;
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
  onDropGroup: _onDropGroup,
  onHoverEntry,
  onConnectGroup: _onConnectGroup,
}: CalendarBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    setHourPx((prev) =>
      Math.max(MIN_HOUR_PX, Math.min(MAX_HOUR_PX, Math.round(prev + (e.deltaY < 0 ? 8 : -8)))),
    );
  }, []);

  const workStartMin = parseHHmm(workStart);
  const workEndMin = Math.max(parseHHmm(workEnd), workStartMin + 60);
  const baseDisplayStart = Math.floor(workStartMin / 60) * 60;
  const baseDisplayEnd = Math.ceil(workEndMin / 60) * 60;

  // Group items per column
  const columnGroups = useMemo(() => {
    const result: Record<ColumnKey, SignalGroup[]> = {
      calendar: [],
      email_sent: [],
      sc_doc: [],
      sc_other: [],
      browser: [],
      other: [],
    };
    for (const colDef of COLUMNS) {
      const colItems = items.filter((i) => itemColumn(i) === colDef.key);
      result[colDef.key] = groupItems(colItems, timezone);
    }
    return result;
  }, [items, timezone]);

  const allGroups = useMemo(() => COLUMNS.map((c) => columnGroups[c.key]), [columnGroups]);

  // Extend display range to include all items
  const { displayStart, displayEnd } = useMemo(() => {
    let start = baseDisplayStart;
    let end = baseDisplayEnd;
    for (const groups of allGroups) {
      for (const g of groups) {
        if (g.startMin < start) start = Math.floor(g.startMin / 60) * 60;
        if (g.endMin > end) end = Math.ceil(g.endMin / 60) * 60;
      }
    }
    return { displayStart: start, displayEnd: end };
  }, [allGroups, baseDisplayStart, baseDisplayEnd]);

  const activeSegments = useMemo(
    () => computeActiveSegments(allGroups, displayStart, displayEnd),
    [allGroups, displayStart, displayEnd],
  );

  const timeScale = useMemo(
    () => buildTimeScale(activeSegments, displayStart, displayEnd, hourPx),
    [activeSegments, displayStart, displayEnd, hourPx],
  );

  // Layout blocks per column
  const columnBlocks = useMemo(() => {
    const result: Record<ColumnKey, PlacedBlock[]> = {
      calendar: [],
      email_sent: [],
      sc_doc: [],
      sc_other: [],
      browser: [],
      other: [],
    };
    for (const colDef of COLUMNS) {
      result[colDef.key] = layoutColumn(
        columnGroups[colDef.key],
        timeScale,
        expandedGroups,
        colDef.color,
        colDef.key,
        usedItemIds,
        generatedItemIds,
      );
    }
    return result;
  }, [columnGroups, timeScale, expandedGroups, usedItemIds, generatedItemIds]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, block: PlacedBlock) => {
    e.dataTransfer.setData('text/daykeeper-items', JSON.stringify(block.itemIds));
    e.dataTransfer.setData('text/daykeeper-item', block.itemIds[0]);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(block.key);
  }, []);

  const handleDragEnd = useCallback(() => setDraggingId(null), []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Render a single block
  function renderBlock(block: PlacedBlock) {
    const isHovered = hoveredBlock === block.key;
    const isExpanded = block.isGrouped && expandedGroups.has(block.key);
    const isPreviewHighlighted =
      highlightedItemIds.size > 0 && block.itemIds.some((id) => highlightedItemIds.has(id));
    const isPreviewDimmed = highlightedItemIds.size > 0 && !isPreviewHighlighted;

    const matterId = block.itemIds
      .map((id) => manualOverrides.get(id))
      .find((v) => v !== undefined && v !== null);
    const matter = matterId ? matters.find((m) => m.id === matterId) : null;
    const matterColor = matter
      ? MATTER_PALETTE[matters.indexOf(matter) % MATTER_PALETTE.length]
      : null;

    return (
      <div
        key={block.key}
        draggable
        onDragStart={(e) => handleDragStart(e, block)}
        onDragEnd={handleDragEnd}
        onClick={
          block.isGrouped
            ? (e) => {
                e.stopPropagation();
                toggleExpand(block.key);
              }
            : undefined
        }
        onMouseEnter={() => {
          setHoveredBlock(block.key);
          onHoverEntry(block.itemIds);
        }}
        onMouseLeave={() => {
          setHoveredBlock(null);
          onHoverEntry(null);
        }}
        className={`group absolute z-10 cursor-grab rounded-md border text-left transition-all duration-150 ${
          isPreviewDimmed ? 'opacity-20' : ''
        } ${isPreviewHighlighted ? 'ring-2 ring-accent-400 ring-offset-1' : ''} ${
          draggingId === block.key ? 'opacity-40' : ''
        } ${isHovered ? 'z-30 overflow-visible shadow-md' : isExpanded ? 'overflow-visible' : 'overflow-hidden'}`}
        style={{
          top: block.topPx,
          left: `${block.leftPct}%`,
          width: `${block.widthPct}%`,
          minHeight: block.heightPx,
          height: isExpanded ? 'auto' : block.heightPx,
          borderColor: block.color,
          backgroundColor: isHovered
            ? '#ffffff'
            : block.isInTimesheet
              ? `${block.color}55`
              : `${block.color}18`,
        }}
      >
        <div
          className="relative min-h-full border-l-[3px] px-1.5 py-1"
          style={{ borderColor: block.color }}
        >
          {/* Header row: label + count + chevron */}
          <div className="flex items-center gap-1">
            {block.heightPx >= 20 && (
              <p className="flex-1 truncate text-[10px] font-medium leading-tight text-stone-700">
                {block.label}
              </p>
            )}
            {block.isGrouped && (
              <span className="shrink-0 rounded bg-stone-200/70 px-1 text-[8px] font-semibold text-stone-600">
                {block.itemCount}
              </span>
            )}
            {block.isGrouped &&
              (isExpanded ? (
                <ChevronUp size={10} className="shrink-0 text-stone-400" />
              ) : (
                <ChevronDown size={10} className="shrink-0 text-stone-400" />
              ))}
          </div>

          {/* Sub-label (time range) — hidden when expanded */}
          {block.heightPx >= 34 && !isExpanded && (
            <p className="truncate text-[9px] leading-tight text-stone-500">
              {block.subLabel}
            </p>
          )}

          {/* Expanded signal list */}
          {isExpanded && (
            <div className="mt-1 space-y-0.5 border-t border-stone-200/50 pt-1">
              {block.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-1.5 text-[9px] text-stone-600"
                >
                  <span className="shrink-0 font-mono text-stone-400">
                    {formatTime(item.timestamp, timezone)}
                  </span>
                  <span className="truncate">
                    {item.meta.subject ??
                      item.meta.title ??
                      item.meta.fileName ??
                      item.summary}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Matter badge */}
          {matter && matterColor && (
            <div
              className="mt-0.5 flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-semibold text-white shadow-sm"
              style={{ backgroundColor: matterColor }}
            >
              <Briefcase size={7} className="shrink-0" />
              <span className="truncate">{matter.name}</span>
            </div>
          )}

          {/* Used indicator */}
          {block.isUsed && (
            <CheckCircle2 size={10} className="absolute right-1 top-1 text-emerald-600" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div
          ref={boardRef}
          className="relative flex"
          style={{ minHeight: timeScale.totalPx + 40 }}
        >
          {/* Time gutter */}
          <div className="sticky left-0 z-20 w-12 shrink-0 bg-stone-50/80 backdrop-blur-sm">
            {timeScale.hourMarkers.map(({ hour, topPx }) => (
              <div
                key={hour}
                className="absolute right-1.5"
                style={{ top: topPx - 6 }}
              >
                <span className="rounded bg-white px-0.5 text-[9px] font-medium text-stone-400">
                  {String(hour % 24).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Columns */}
          {COLUMNS.map((colDef) => {
            const colBlocks = columnBlocks[colDef.key];
            const Icon = colDef.icon;
            return (
              <div
                key={colDef.key}
                className="relative flex-1 border-l border-stone-200"
              >
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

                {/* Column body */}
                <div className="relative" style={{ height: timeScale.totalPx }}>
                  {/* Hour grid lines */}
                  {timeScale.hourMarkers.map(({ hour, topPx }) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 border-t border-stone-100"
                      style={{ top: topPx }}
                    />
                  ))}

                  {/* Blocks */}
                  {colBlocks.map((block) => renderBlock(block))}
                </div>
              </div>
            );
          })}

          {/* Collapsed bands — behind columns, spanning full width */}
          {timeScale.gaps.map((gap) => (
            <div
              key={`gap-${gap.start}-${gap.end}`}
              className="pointer-events-none absolute left-12 right-0 z-0 flex items-center justify-center border-t border-b border-dashed border-stone-300"
              style={{ top: gap.topPx, height: COLLAPSED_BAND_PX }}
            >
              <span className="text-[10px] text-stone-400">
                {formatMinutes(gap.end - gap.start)} — no activity
              </span>
            </div>
          ))}
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
