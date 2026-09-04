import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
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
  Briefcase,
  Plus,
  CheckCircle2,
  Link2,
  X,
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

const COL_INDEX: Record<ColumnKey, number> = {
  calendar: 0,
  email_sent: 1,
  sc_doc: 2,
  sc_other: 3,
  browser: 4,
  other: 5,
};

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

// ── Connection detection ───────────────────────────────────────────────────
// Two blocks are "connected" if their time ranges overlap (even partially)
// and they are in different columns. This lets the user see which signals
// happened at the same time across different sources.

interface Connection {
  fromKey: string;
  toKey: string;
  fromCol: number;
  toCol: number;
  y1: number;
  y2: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
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
  recentMatterIds: string[];
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
const CONNECTION_HEADER_OFFSET = 36;

export function CalendarBoard({
  items,
  matters,
  timezone,
  workStart,
  workEnd,
  usedItemIds,
  generatedItemIds,
  highlightedItemIds,
  recentMatterIds,
  onAssign: _onAssign,
  onDropGroup,
  onHoverEntry,
  onConnectGroup,
}: CalendarBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverMatter, setDragOverMatter] = useState<string | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [manualLinks, setManualLinks] = useState<Set<string>>(new Set());
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(600);

  // Cmd/Ctrl + scroll to zoom the calendar time scale
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    setHourPx((prev) => {
      const next = Math.round(prev + (e.deltaY < 0 ? 8 : -8));
      return Math.max(MIN_HOUR_PX, Math.min(MAX_HOUR_PX, next));
    });
  }, []);

  useEffect(() => {
    if (!boardRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBoardWidth(entry.contentRect.width);
      }
    });
    ro.observe(boardRef.current);
    return () => ro.disconnect();
  }, []);

  const startMin = parseHHmm(workStart);
  const endMin = Math.max(parseHHmm(workEnd), startMin + 60);
  const displayStart = Math.floor(startMin / 60) * 60;
  const displayEnd = Math.ceil(endMin / 60) * 60;
  const totalPx = ((displayEnd - displayStart) / 60) * hourPx + 8;

  // Time gutter width
  const GUTTER_W = 48;

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

  // All blocks flat for connection computation
  const allBlocks = useMemo(() => {
    return COLUMNS.flatMap((c) => columns[c.key]);
  }, [columns]);

  // Compute connections between blocks that overlap in time across different columns
  const connections = useMemo<Connection[]>(() => {
    const conns: Connection[] = [];
    for (let i = 0; i < allBlocks.length; i++) {
      for (let j = i + 1; j < allBlocks.length; j++) {
        const a = allBlocks[i];
        const b = allBlocks[j];
        if (a.column === b.column) continue;
        if (!overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue;
        const aCol = COL_INDEX[a.column];
        const bCol = COL_INDEX[b.column];
        const [from, to] = aCol < bCol ? [a, b] : [b, a];
        const fromCol = aCol < bCol ? aCol : bCol;
        const toCol = aCol < bCol ? bCol : aCol;
        // Only connect adjacent columns to avoid visual clutter
        if (toCol - fromCol > 1) continue;
        const y1 = CONNECTION_HEADER_OFFSET + ((from.startMin + from.endMin) / 2 - displayStart) / 60 * hourPx;
        const y2 = CONNECTION_HEADER_OFFSET + ((to.startMin + to.endMin) / 2 - displayStart) / 60 * hourPx;
        conns.push({
          fromKey: from.key,
          toKey: to.key,
          fromCol,
          toCol,
          y1,
          y2,
        });
      }
    }
    return conns;
  }, [allBlocks, displayStart, hourPx]);

  // Build a map of block key → connected block keys (auto-overlap + manual links)
  const connectionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const addLink = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    };
    for (const conn of connections) addLink(conn.fromKey, conn.toKey);
    for (const link of manualLinks) {
      const [a, b] = link.split('::');
      if (a && b) addLink(a, b);
    }
    return map;
  }, [connections, manualLinks]);

  // Get all item IDs to drag when dragging a block (the block itself + all connected blocks)
  const getDragGroupIds = useCallback((block: PlacedBlock): string[] => {
    const connected = connectionMap.get(block.key);
    if (!connected || connected.size === 0) return block.itemIds;
    const allKeys = new Set<string>([block.key, ...connected]);
    const allIds = new Set<string>();
    for (const key of allKeys) {
      const blk = allBlocks.find((b) => b.key === key);
      if (blk) blk.itemIds.forEach((id) => allIds.add(id));
    }
    return Array.from(allIds);
  }, [connectionMap, allBlocks]);

  // Manual link key helper
  const linkKey = useCallback((a: string, b: string) => {
    return [a, b].sort().join('::');
  }, []);

  // Start connecting from a block
  const handleStartConnect = useCallback((e: React.MouseEvent, block: PlacedBlock) => {
    e.stopPropagation();
    e.preventDefault();
    setConnectingFrom(block.key);
  }, []);

  // Complete a manual connection by clicking a target block
  const handleCompleteConnect = useCallback((block: PlacedBlock) => {
    if (!connectingFrom) return;
    if (connectingFrom === block.key) {
      setConnectingFrom(null);
      return;
    }
    const key = linkKey(connectingFrom, block.key);
    setManualLinks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    // Gather all item IDs in the now-connected group and notify parent
    const connected = connectionMap.get(connectingFrom);
    const groupKeys = new Set<string>([connectingFrom, block.key]);
    if (connected) connected.forEach((k) => groupKeys.add(k));
    const connFromLinks = new Set<string>([connectingFrom, block.key]);
    // Also include items connected via auto-overlap
    for (const k of groupKeys) {
      const c = connectionMap.get(k);
      if (c) c.forEach((ck) => connFromLinks.add(ck));
    }
    const allIds = new Set<string>();
    for (const k of connFromLinks) {
      const blk = allBlocks.find((b) => b.key === k);
      if (blk) blk.itemIds.forEach((id) => allIds.add(id));
    }
    if (allIds.size > 1) {
      onConnectGroup(Array.from(allIds));
    }
    setConnectingFrom(null);
  }, [connectingFrom, linkKey, connectionMap, allBlocks, onConnectGroup]);

  // Remove a manual link
  const handleRemoveLink = useCallback((e: React.MouseEvent, a: string, b: string) => {
    e.stopPropagation();
    e.preventDefault();
    const key = linkKey(a, b);
    setManualLinks((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [linkKey]);

  // Hour markers
  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = displayStart / 60; h < displayEnd / 60; h++) {
      arr.push(h);
    }
    return arr;
  }, [displayStart, displayEnd]);

  // Recent matters as buckets
  const bucketMatters = useMemo(() => {
    const recent = recentMatterIds
      .map((id) => matters.find((m) => m.id === id))
      .filter((m): m is Matter => Boolean(m));
    if (recent.length < 5) {
      const extra = matters
        .filter((m) => !recent.find((r) => r.id === m.id))
        .slice(0, 5 - recent.length);
      return [...recent, ...extra];
    }
    return recent;
  }, [recentMatterIds, matters]);

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
    setDragOverMatter(null);
  }, []);

  const handleMatterDrop = useCallback((e: React.DragEvent, matterId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = e.dataTransfer.getData('text/daykeeper-items');
    let ids: string[];
    try {
      ids = JSON.parse(payload);
    } catch {
      ids = [e.dataTransfer.getData('text/daykeeper-item')];
    }
    if (ids.length > 0 && ids[0]) {
      onDropGroup(ids, matterId);
    }
    setDragOverMatter(null);
  }, [onDropGroup]);

  // Compute which block keys are connected to the hovered block (for highlighting connections)
  const hoveredConnections = useMemo(() => {
    if (!hoveredBlock) return new Set<string>();
    const connected = connectionMap.get(hoveredBlock);
    if (!connected) return new Set<string>();
    return new Set([hoveredBlock, ...connected]);
  }, [hoveredBlock, connectionMap]);

  // Render a single block
  function renderBlock(block: PlacedBlock) {
    const topPx = ((block.startMin - displayStart) / 60) * hourPx;
    const heightPx = Math.max(MIN_BLOCK_PX, ((block.endMin - block.startMin) / 60) * hourPx);
    // Highlight from timesheet preview hover
    const isPreviewHighlighted = highlightedItemIds.size > 0 && block.itemIds.some((id) => highlightedItemIds.has(id));
    const isPreviewDimmed = highlightedItemIds.size > 0 && !isPreviewHighlighted;
    // Highlight from calendar hover (connection lines)
    const isConnected = hoveredConnections.size > 0 && hoveredConnections.has(block.key);
    const isHovered = hoveredBlock === block.key;
    const isConnectingTarget = connectingFrom !== null && connectingFrom !== block.key;
    const isConnectingSource = connectingFrom === block.key;
    const hasManualLinks = Array.from(manualLinks).some((l) => l.includes(block.key));
    const width = Math.max(60, 100 / block.laneCount - 3);
    const left = (block.lane * 100) / block.laneCount + 1.5;

    return (
      <div
        key={block.key}
        draggable={connectingFrom === null}
        onDragStart={(e) => handleDragStart(e, block)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (connectingFrom !== null) handleCompleteConnect(block);
        }}
        onMouseEnter={() => {
          setHoveredBlock(block.key);
        }}
        onMouseLeave={() => {
          setHoveredBlock(null);
        }}
        className={`group absolute overflow-hidden rounded-md border text-left transition-all duration-150 ${
          connectingFrom !== null ? 'cursor-crosshair' : 'cursor-grab'
        } ${
          isPreviewDimmed ? 'opacity-20' : ''
        } ${isPreviewHighlighted ? 'ring-2 ring-accent-400 ring-offset-1' : ''} ${
          isConnected && !isHovered ? 'ring-2 ring-amber-300 ring-offset-1' : ''
        } ${isConnectingSource ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${
          isConnectingTarget ? 'ring-2 ring-blue-300 ring-offset-1' : ''
        } ${hasManualLinks ? 'ring-1 ring-blue-400' : ''} ${
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
          {block.isUsed && (
            <CheckCircle2 size={10} className="absolute right-1 top-1 text-emerald-600" />
          )}
          {/* Connect button — appears on hover */}
          {connectingFrom === null && (
            <button
              onClick={(e) => handleStartConnect(e, block)}
              className="absolute right-1 bottom-1 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-white/90 p-0.5 shadow-sm hover:bg-blue-50"
              title="Connect to another signal"
            >
              <Link2 size={11} className="text-stone-500 hover:text-blue-600" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Column width in px (for SVG positioning)
  const colWidth = Math.max(80, (boardWidth - GUTTER_W) / COLUMNS.length);

  // SVG overlay for connection lines (auto-overlap + manual)
  const connectionLines = useMemo(() => {
    const autoLines = connections.map((conn, i) => {
      const x1 = GUTTER_W + conn.fromCol * colWidth + colWidth - 2;
      const x2 = GUTTER_W + conn.toCol * colWidth + 2;
      const isHovered = hoveredConnections.size > 0 && (hoveredConnections.has(conn.fromKey) || hoveredConnections.has(conn.toKey));
      const midX = (x1 + x2) / 2;
      return (
        <path
          key={`auto-${i}`}
          d={`M ${x1} ${conn.y1} C ${midX} ${conn.y1}, ${midX} ${conn.y2}, ${x2} ${conn.y2}`}
          fill="none"
          stroke={isHovered ? '#f59e0b' : '#cbd5e1'}
          strokeWidth={isHovered ? 1.5 : 1}
          strokeDasharray={isHovered ? '0' : '3 3'}
          opacity={isHovered ? 0.8 : 0.4}
          style={{ transition: 'stroke 0.15s, opacity 0.15s, stroke-width 0.15s' }}
        />
      );
    });

    // Manual link lines
    const manualLines = Array.from(manualLinks).map((link) => {
      const [keyA, keyB] = link.split('::');
      const blkA = allBlocks.find((b) => b.key === keyA);
      const blkB = allBlocks.find((b) => b.key === keyB);
      if (!blkA || !blkB) return null;
      const colA = COL_INDEX[blkA.column];
      const colB = COL_INDEX[blkB.column];
      const sameColumn = colA === colB;
      const [fromBlk, toBlk, fromCol, toCol] = sameColumn
        ? (blkA.startMin <= blkB.startMin ? [blkA, blkB, colA, colB] : [blkB, blkA, colB, colA])
        : (colA < colB ? [blkA, blkB, colA, colB] : [blkB, blkA, colB, colA]);
      const y1 = CONNECTION_HEADER_OFFSET + ((fromBlk.startMin + fromBlk.endMin) / 2 - displayStart) / 60 * hourPx;
      const y2 = CONNECTION_HEADER_OFFSET + ((toBlk.startMin + toBlk.endMin) / 2 - displayStart) / 60 * hourPx;
      const columnLeft = GUTTER_W + fromCol * colWidth;
      const x1 = sameColumn ? columnLeft + colWidth - 8 : columnLeft + colWidth - 2;
      const x2 = sameColumn ? x1 : GUTTER_W + toCol * colWidth + 2;
      const midX = sameColumn ? x1 + 18 : (x1 + x2) / 2;
      const curveY1 = sameColumn ? y1 : y1;
      const curveY2 = sameColumn ? y2 : y2;
      const isHovered = hoveredConnections.size > 0 && (hoveredConnections.has(keyA) || hoveredConnections.has(keyB));
      return (
        <g key={`manual-${link}`}>
          <path
            d={`M ${x1} ${curveY1} C ${midX} ${curveY1}, ${midX} ${curveY2}, ${x2} ${curveY2}`}
            fill="none"
            stroke={isHovered ? '#f59e0b' : '#2563eb'}
            strokeWidth={isHovered ? 2.5 : 2}
            opacity={isHovered ? 1 : 0.7}
            style={{ transition: 'stroke 0.15s, opacity 0.15s, stroke-width 0.15s' }}
          />
          {/* Remove button at midpoint */}
          <circle
            cx={midX}
            cy={(y1 + y2) / 2}
            r={7}
            fill="white"
            stroke={isHovered ? '#f59e0b' : '#2563eb'}
            strokeWidth={1.5}
            className="pointer-events-auto cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveLink(e as unknown as React.MouseEvent, keyA, keyB);
            }}
          />
          <text
            x={midX}
            y={(y1 + y2) / 2 + 3}
            textAnchor="middle"
            fontSize={9}
            fill={isHovered ? '#f59e0b' : '#2563eb'}
            className="pointer-events-none select-none"
          >
            ×
          </text>
        </g>
      );
    }).filter(Boolean);

    return [...autoLines, ...manualLines];
  }, [connections, manualLinks, allBlocks, hoveredConnections, colWidth, hourPx, displayStart, hoveredBlock, handleRemoveLink]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Connecting mode banner */}
      {connectingFrom !== null && (
        <div className="shrink-0 flex items-center justify-between gap-2 bg-blue-50 border-b border-blue-200 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-blue-700">
            <Link2 size={14} />
            <span className="font-medium">Click another signal to connect them</span>
          </div>
          <button
            onClick={() => setConnectingFrom(null)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      )}
      {/* Calendar board — scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onWheel={handleWheel}>
        <div ref={boardRef} className="relative flex gap-0" style={{ minHeight: totalPx + 40 }}>
          {/* SVG connection overlay */}
          <svg
            className="pointer-events-none absolute inset-0 z-[5]"
            width={boardWidth}
            height={totalPx + 40}
            style={{ overflow: 'visible' }}
          >
            {connectionLines}
          </svg>

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

      {/* Case buckets — below the calendar */}
      <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Briefcase size={14} className="text-stone-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Recent Cases
          </span>
          <span className="text-[10px] text-stone-400">
            Drag signals (or connected groups) here to create timesheet entries
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {bucketMatters.map((matter) => {
            const isDropTarget = dragOverMatter === matter.id;
            return (
              <div
                key={matter.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverMatter(matter.id);
                }}
                onDragLeave={() => setDragOverMatter(null)}
                onDrop={(e) => handleMatterDrop(e, matter.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-150 ${
                  isDropTarget
                    ? 'border-accent-400 bg-accent-50 ring-2 ring-accent-300'
                    : 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-stone-100'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: MATTER_PALETTE[bucketMatters.indexOf(matter) % MATTER_PALETTE.length] }}
                />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-stone-700">
                    {matter.case_id_visible ?? matter.name}
                  </p>
                  <p className="truncate text-[10px] text-stone-400">{matter.name}</p>
                </div>
              </div>
            );
          })}
          {bucketMatters.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-400">
              <Plus size={14} />
              <span>No matters yet — connect SingleCase in Settings</span>
            </div>
          )}
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
