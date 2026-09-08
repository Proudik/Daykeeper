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
  CheckCircle2,
  Briefcase,
  ChevronDown,
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
    const earliestMin = timestampToMinutes(blockItems[0].timestamp, timezone);
    const endMin = earliestMin + Math.max(totalMinutes, 15);
    groups.push({
      key: `browser-${blockStart}`,
      label: topDomains.length > 0 ? topDomains.join(', ') : 'Browsing',
      subLabel: `${blockItems.length} ${blockItems.length === 1 ? 'site' : 'sites'} · ${formatMinutes(totalMinutes)}`,
      itemCount: blockItems.length,
      startMin: earliestMin,
      endMin: Math.max(endMin, earliestMin + 30),
      totalMinutes,
      itemIds: blockItems.map((i) => i.id),
    });
  }
  return groups.sort((a, b) => a.startMin - b.startMin);
}

// ── Block type ──────────────────────────────────────────────────────────────

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
  topPx?: number;
  heightPx?: number;
  isStacked?: boolean;
  stackGroupKey?: string;
  stackCount?: number;
}

// ── Lane assignment (for split groups, ≤ MAX_LANES) ─────────────────────────

function assignLanes(blocks: { startMin: number; endMin: number; key: string }[]): { lane: number; laneCount: number }[] {
  const sorted = blocks
    .map((block, index) => ({ ...block, index }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = [];
  const result = blocks.map(() => ({ lane: 0, laneCount: 1 }));

  for (const block of sorted) {
    let lane = laneEnds.findIndex((end) => end <= block.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.endMin;
    result[block.index] = { lane, laneCount: 1 };
  }

  const visited = new Set<number>();
  for (let start = 0; start < blocks.length; start++) {
    if (visited.has(start)) continue;

    const group: number[] = [start];
    visited.add(start);
    for (let cursor = 0; cursor < group.length; cursor++) {
      const current = blocks[group[cursor]];
      for (let index = 0; index < blocks.length; index++) {
        if (visited.has(index)) continue;
        const candidate = blocks[index];
        if (candidate.startMin < current.endMin && candidate.endMin > current.startMin) {
          visited.add(index);
          group.push(index);
        }
      }
    }

    const laneCount = Math.max(...group.map((index) => result[index].lane + 1), 1);
    for (const index of group) {
      result[index].laneCount = laneCount;
    }
  }

  return result;
}

// ── Non-linear scale for collapsing empty time ──────────────────────────────

const COLLAPSE_THRESHOLD_MIN = 15;
const COLLAPSED_BAND_PX = 20;
const OVERLAP_TOLERANCE_MIN = 5;
const MAX_LANES = 2;
const TRANSITION_MS = 280;

interface ScaleSegment {
  startMin: number;
  endMin: number;
  type: 'active' | 'gap';
  gapId?: string;
  px: number;
}

function buildScale(
  allBlocks: { startMin: number; endMin: number }[],
  displayStart: number,
  displayEnd: number,
  collapseEmpty: boolean,
  expandedGapIds: Set<string>,
  hourPx: number,
): { segments: ScaleSegment[]; gapSegments: ScaleSegment[]; totalPx: number; minuteToPx: (min: number) => number } {
  // Keep every hour containing an activity at the normal scale. Only fully
  // empty clock hours are eligible for collapsing.
  const occupiedHours = new Set(
    allBlocks.map((block) => Math.floor(block.startMin / 60) * 60),
  );
  const gaps: { start: number; end: number; id: string }[] = [];
  let emptyStart: number | null = null;
  for (let hour = displayStart; hour < displayEnd; hour += 60) {
    const isEmpty = !occupiedHours.has(hour);
    if (isEmpty && emptyStart === null) emptyStart = hour;
    if ((!isEmpty || hour + 60 >= displayEnd) && emptyStart !== null) {
      const end = isEmpty && hour + 60 >= displayEnd ? hour + 60 : hour;
      if (end - emptyStart >= COLLAPSE_THRESHOLD_MIN) {
        gaps.push({ start: emptyStart, end, id: `gap-${emptyStart}-${end}` });
      }
      emptyStart = null;
    }
  }

  // Build alternating active/gap segments
  const segments: ScaleSegment[] = [];
  let segCursor = displayStart;
  for (const gap of gaps) {
    segments.push({ startMin: segCursor, endMin: gap.start, type: 'active', px: 0 });
    const isCollapsed = collapseEmpty && !expandedGapIds.has(gap.id);
    segments.push({
      startMin: gap.start,
      endMin: gap.end,
      type: isCollapsed ? 'gap' : 'active',
      gapId: gap.id,
      px: 0,
    });
    segCursor = gap.end;
  }
  if (segCursor < displayEnd) {
    segments.push({ startMin: segCursor, endMin: displayEnd, type: 'active', px: 0 });
  }
  if (segments.length === 0) {
    segments.push({ startMin: displayStart, endMin: displayEnd, type: 'active', px: 0 });
  }

  // Compute pixel heights
  let totalPx = 0;
  for (const seg of segments) {
    seg.px = seg.type === 'gap'
      ? COLLAPSED_BAND_PX
      : ((seg.endMin - seg.startMin) / 60) * hourPx;
    totalPx += seg.px;
  }

  // Build minuteToPx lookup
  const offsets: number[] = [];
  let cumPx = 0;
  for (const seg of segments) {
    offsets.push(cumPx);
    cumPx += seg.px;
  }

  const minuteToPx = (min: number): number => {
    for (let i = 0; i < segments.length; i++) {
      if (min >= segments[i].startMin && min <= segments[i].endMin) {
        const seg = segments[i];
        if (seg.endMin === seg.startMin) return offsets[i];
        return offsets[i] + ((min - seg.startMin) / (seg.endMin - seg.startMin)) * seg.px;
      }
    }
    if (min < segments[0].startMin) return ((min - segments[0].startMin) / 60) * hourPx;
    return totalPx + ((min - segments[segments.length - 1].endMin) / 60) * hourPx;
  };

  const gapSegments = segments.filter((s) => s.gapId !== undefined);

  return { segments, gapSegments, totalPx, minuteToPx };
}

// ── Min height & packing ────────────────────────────────────────────────────

function computeMinHeight(block: PlacedBlock, manualOverrides: Map<string, string | null>): number {
  const hasMatter = block.itemIds.some((id) => {
    const m = manualOverrides.get(id);
    return m !== undefined && m !== null;
  });
  if (block.isAggregate) return hasMatter ? 60 : 44;
  return hasMatter ? 40 : 24;
}

function extendForStackedLayout(
  blocks: PlacedBlock[],
  manualOverrides: Map<string, string | null>,
  hourPx: number,
): { startMin: number; endMin: number }[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
  const result = sorted.map((block) => ({ startMin: block.startMin, endMin: block.endMin }));
  let groupStart = -Infinity;
  let groupEnd = -Infinity;
  let groupIndexes: number[] = [];
  const stackIntervals: { startMin: number; endMin: number }[] = [];

  const flush = () => {
    if (groupIndexes.length <= MAX_LANES) return;
    const requiredPx = groupIndexes.reduce((sum, index) => {
      return sum + computeMinHeight(sorted[index], manualOverrides);
    }, 0) + (groupIndexes.length - 1) * 2;
    const requiredEnd = groupStart + (requiredPx / hourPx) * 60;
    stackIntervals.push({ startMin: groupStart, endMin: Math.max(groupEnd, requiredEnd) });
  };

  for (let index = 0; index < sorted.length; index++) {
    const block = sorted[index];
    if (groupIndexes.length === 0 || block.startMin <= groupEnd + OVERLAP_TOLERANCE_MIN) {
      groupIndexes.push(index);
      groupStart = groupIndexes.length === 1 ? block.startMin : groupStart;
      groupEnd = Math.max(groupEnd, block.endMin);
    } else {
      flush();
      groupIndexes = [index];
      groupStart = block.startMin;
      groupEnd = block.endMin;
    }
  }
  flush();

  return [...result, ...stackIntervals];
}

function packColumn(
  blocks: PlacedBlock[],
  minuteToPx: (min: number) => number,
  minHeights: Map<string, number>,
  expandedStackKeys: Set<string>,
): PlacedBlock[] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);

  // Group overlapping blocks (with tolerance for sequential bursts)
  const groups: PlacedBlock[][] = [];
  let currentGroup: PlacedBlock[] = [];
  let groupEnd = -Infinity;

  for (const block of sorted) {
    if (currentGroup.length === 0 || block.startMin <= groupEnd + OVERLAP_TOLERANCE_MIN) {
      currentGroup.push(block);
      groupEnd = Math.max(groupEnd, block.endMin);
    } else {
      groups.push(currentGroup);
      currentGroup = [block];
      groupEnd = block.endMin;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  const packed: PlacedBlock[] = [];
  let floorPx = 0;

  for (const group of groups) {
    const stackGroupKey = group.length > MAX_LANES
      ? `stack-${group.map((block) => block.key).join('|')}`
      : null;

    if (stackGroupKey && !expandedStackKeys.has(stackGroupKey)) {
      const first = group[0];
      const startMin = Math.min(...group.map((block) => block.startMin));
      const endMin = Math.max(...group.map((block) => block.endMin));
      const topPx = Math.max(minuteToPx(startMin), floorPx);
      const heightPx = Math.max(44, minuteToPx(endMin) - minuteToPx(startMin));
      packed.push({
        ...first,
        key: stackGroupKey,
        label: `${group.length} overlapping activities`,
        subLabel: 'Click to expand',
        startMin,
        endMin,
        topPx,
        heightPx,
        lane: 0,
        laneCount: 1,
        itemIds: group.flatMap((block) => block.itemIds),
        isAggregate: true,
        isStacked: true,
        stackGroupKey,
        stackCount: group.length,
      });
      floorPx = topPx + heightPx + 2;
    } else if (group.length <= MAX_LANES) {
      // Split: side-by-side lanes
      const laneAssignments = assignLanes(group);
      const laneCount = Math.max(...laneAssignments.map((a) => a.lane + 1));
      let groupBottom = 0;

      for (let i = 0; i < group.length; i++) {
        const block = group[i];
        const naturalTop = minuteToPx(block.startMin);
        const topPx = Math.max(naturalTop, floorPx);
        const naturalHeight = minuteToPx(block.endMin) - minuteToPx(block.startMin);
        const minHeight = minHeights.get(block.key) ?? 24;
        const heightPx = Math.max(minHeight, naturalHeight);

        packed.push({ ...block, lane: laneAssignments[i].lane, laneCount, topPx, heightPx });
        groupBottom = Math.max(groupBottom, topPx + heightPx);
      }
      floorPx = groupBottom + 2;
    } else {
      // Stack: full width, one below another in start order
      for (const block of group) {
        const naturalTop = minuteToPx(block.startMin);
        const topPx = Math.max(naturalTop, floorPx);
        const naturalHeight = minuteToPx(block.endMin) - minuteToPx(block.startMin);
        const minHeight = minHeights.get(block.key) ?? 24;
        const heightPx = Math.max(minHeight, naturalHeight);

        packed.push({
          ...block,
          lane: 0,
          laneCount: 1,
          topPx,
          heightPx,
          isStacked: true,
          stackGroupKey,
        });
        floorPx = topPx + heightPx + 2;
      }
    }
  }

  return packed;
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
  collapseEmpty: boolean;
}

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
  onDropGroup: _onDropGroup,
  onHoverEntry: _onHoverEntry,
  onConnectGroup: _onConnectGroup,
  collapseEmpty,
}: CalendarBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const [expandedGapIds, setExpandedGapIds] = useState<Set<string>>(new Set());
  const [expandedStackKeys, setExpandedStackKeys] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpandedGapIds(new Set());
  }, [items]);

  useEffect(() => {
    if (!collapseEmpty) setExpandedGapIds(new Set());
  }, [collapseEmpty]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    setHourPx((prev) => {
      const next = Math.round(prev + (e.deltaY < 0 ? 8 : -8));
      return Math.max(MIN_HOUR_PX, Math.min(MAX_HOUR_PX, next));
    });
  }, []);

  const workStartMin = parseHHmm(workStart);
  const workEndMin = Math.max(parseHHmm(workEnd), workStartMin + 60);
  const baseDisplayStart = Math.floor(workStartMin / 60) * 60;
  const baseDisplayEnd = Math.ceil(workEndMin / 60) * 60;

  // Build raw blocks per column (no lane assignment yet)
  const rawColumns = useMemo(() => {
    const result: Record<ColumnKey, PlacedBlock[]> = {
      calendar: [], email_sent: [], sc_doc: [], sc_other: [], browser: [], other: [],
    };

    for (const colDef of COLUMNS) {
      const colItems = items.filter((i) => itemColumn(i) === colDef.key);

      if (colDef.key === 'sc_other') {
        const groups = aggregateScOther(colItems, timezone);
        result.sc_other = groups.map((g) => ({
          key: g.key, label: g.label, subLabel: g.subLabel,
          startMin: g.startMin, endMin: g.endMin,
          lane: 0, laneCount: 1, color: colDef.color,
          itemIds: g.itemIds, isAggregate: true,
          caseId: g.caseId, caseName: g.caseName, column: colDef.key,
          isUsed: g.itemIds.every((id) => usedItemIds.has(id)),
          isInTimesheet: g.itemIds.some((id) => generatedItemIds.has(id)),
        }));
        continue;
      }

      if (colDef.key === 'browser') {
        const groups = aggregateBrowser(colItems, timezone);
        result.browser = groups.map((g) => ({
          key: g.key, label: g.label, subLabel: g.subLabel,
          startMin: g.startMin, endMin: g.endMin,
          lane: 0, laneCount: 1, color: colDef.color,
          itemIds: g.itemIds, isAggregate: true, column: colDef.key,
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
        const assignedMatterId = manualOverrides.get(item.id);
        const assignedBlockMinutes = Math.ceil((64 / hourPx) * 60);
        const minimumDuration = assignedMatterId ? assignedBlockMinutes : 15;
        const visualEnd = duration < minimumDuration ? sMin + minimumDuration : eMin;
        return { item, startMin: sMin, endMin: visualEnd, key: item.id };
      });

      result[colDef.key] = blockItems.map((b) => ({
        key: b.key,
        label: b.item.meta.subject ?? b.item.meta.title ?? b.item.meta.fileName ?? b.item.summary,
        subLabel: b.item.endTimestamp
          ? formatTimeRange(b.item.timestamp, b.item.endTimestamp, timezone)
          : formatTime(b.item.timestamp, timezone),
        startMin: b.startMin, endMin: b.endMin,
        lane: 0, laneCount: 1, color: colDef.color,
        itemIds: [b.item.id], isAggregate: false,
        originalItem: b.item, column: colDef.key,
        isUsed: usedItemIds.has(b.item.id),
        isInTimesheet: generatedItemIds.has(b.item.id),
      }));
    }
    return result;
  }, [items, timezone, usedItemIds, generatedItemIds, manualOverrides, hourPx]);

  // Extend display range to include all items
  const { displayStart, displayEnd } = useMemo(() => {
    let start = baseDisplayStart;
    let end = baseDisplayEnd;
    for (const col of COLUMNS) {
      for (const block of rawColumns[col.key]) {
        if (block.startMin < start) start = Math.floor(block.startMin / 60) * 60;
        if (block.endMin > end) end = Math.ceil(block.endMin / 60) * 60;
      }
    }
    return { displayStart: start, displayEnd: end };
  }, [rawColumns, baseDisplayStart, baseDisplayEnd]);

  // Gap detection follows the visible blocks, not hidden signals inside aggregates.
  const activityIntervals = useMemo(() => {
    return COLUMNS.flatMap((column) =>
      rawColumns[column.key].map((block) => ({
        startMin: block.startMin,
        endMin: block.startMin,
      })),
    );
  }, [rawColumns]);

  // Build non-linear scale after accounting for the vertical space needed by stacks.
  const { segments, gapSegments, minuteToPx, totalPx } = useMemo(
    () => buildScale(activityIntervals, displayStart, displayEnd, collapseEmpty, expandedGapIds, hourPx),
    [activityIntervals, displayStart, displayEnd, collapseEmpty, expandedGapIds, hourPx],
  );

  // Pack each column with stacking
  const packedColumns = useMemo(() => {
    const result: Record<ColumnKey, PlacedBlock[]> = {
      calendar: [], email_sent: [], sc_doc: [], sc_other: [], browser: [], other: [],
    };
    for (const colDef of COLUMNS) {
      const minHeights = new Map<string, number>();
      for (const block of rawColumns[colDef.key]) {
        minHeights.set(block.key, computeMinHeight(block, manualOverrides));
      }
      result[colDef.key] = packColumn(rawColumns[colDef.key], minuteToPx, minHeights, expandedStackKeys);
    }
    return result;
  }, [rawColumns, minuteToPx, manualOverrides, expandedStackKeys]);

  // After packing, the actual height may exceed the scale-based totalPx
  // because stacked blocks get pushed down beyond their natural time positions.
  const effectiveTotalPx = useMemo(() => {
    let maxBottom = 0;
    for (const col of COLUMNS) {
      for (const block of packedColumns[col.key]) {
        const bottom = (block.topPx ?? 0) + (block.heightPx ?? 24);
        if (bottom > maxBottom) maxBottom = bottom;
      }
    }
    return Math.max(totalPx, maxBottom + 4);
  }, [packedColumns, totalPx]);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = displayStart / 60; h < displayEnd / 60; h++) arr.push(h);
    return arr;
  }, [displayStart, displayEnd]);

  const isHourInCollapsedGap = useCallback((min: number) => {
    for (const seg of segments) {
      if (seg.type === 'gap' && min >= seg.startMin && min < seg.endMin) return true;
    }
    return false;
  }, [segments]);

  const handleDragStart = useCallback((e: React.DragEvent, block: PlacedBlock) => {
    e.dataTransfer.setData('text/daykeeper-items', JSON.stringify(block.itemIds));
    e.dataTransfer.setData('text/daykeeper-item', block.itemIds[0]);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(block.key);
  }, []);

  const handleDragEnd = useCallback(() => setDraggingId(null), []);

  function toggleGap(gapId: string) {
    setExpandedGapIds((prev) => {
      const next = new Set(prev);
      if (next.has(gapId)) next.delete(gapId);
      else next.add(gapId);
      return next;
    });
  }

  function renderBlock(block: PlacedBlock) {
    const topPx = block.topPx ?? 0;
    const heightPx = block.heightPx ?? 24;
    const isPreviewHighlighted = highlightedItemIds.size > 0 && block.itemIds.some((id) => highlightedItemIds.has(id));
    const isPreviewDimmed = highlightedItemIds.size > 0 && !isPreviewHighlighted;
    const isHovered = hoveredBlock === block.key;
    const width = Math.max(24, 100 / block.laneCount - 3);
    const isStackGroup = Boolean(block.stackGroupKey);
    const left = (block.lane * 100) / block.laneCount + 1.5;

    const matterId = block.itemIds
      .map((id) => manualOverrides.get(id))
      .find((v) => v !== undefined && v !== null);
    const matter = matterId ? matters.find((m) => m.id === matterId) : null;
    const matterColor = matter ? MATTER_PALETTE[matters.indexOf(matter) % MATTER_PALETTE.length] : null;
    const expandedWidth = Math.min(92, Math.max(width, 48));
    const hasMatter = Boolean(matter);

    return (
      <div
        key={block.key}
        draggable={!isStackGroup}
        onClick={() => {
          if (!block.stackGroupKey) return;
          setExpandedStackKeys((prev) => {
            const next = new Set(prev);
            if (next.has(block.stackGroupKey!)) next.delete(block.stackGroupKey!);
            else next.add(block.stackGroupKey!);
            return next;
          });
        }}
        onDragStart={(e) => handleDragStart(e, block)}
        onDragEnd={handleDragEnd}
        onMouseEnter={() => setHoveredBlock(block.key)}
        onMouseLeave={() => setHoveredBlock(null)}
        className={`group absolute z-10 cursor-grab rounded-md border text-left ${
          isPreviewDimmed ? 'opacity-20' : ''
        } ${isPreviewHighlighted ? 'ring-2 ring-accent-400 ring-offset-1' : ''} ${
          draggingId === block.key ? 'opacity-40' : ''
        } ${isStackGroup ? 'cursor-pointer' : ''} ${isHovered ? 'z-30 overflow-visible shadow-md' : 'overflow-hidden'}`}
        style={{
          top: topPx,
          height: isHovered ? 'auto' : heightPx,
          minHeight: heightPx,
          left: `${left}%`,
          width: `${isHovered ? expandedWidth : width}%`,
          borderColor: block.color,
          backgroundColor: isHovered ? '#ffffff' : block.isInTimesheet ? `${block.color}55` : `${block.color}18`,
          transition: `top ${TRANSITION_MS}ms ease-out, height ${TRANSITION_MS}ms ease-out, opacity 150ms ease-out, left 150ms ease-out, width 150ms ease-out`,
        }}
      >
        <div className="relative min-h-full border-l-[3px] px-1.5 py-1" style={{ borderColor: block.color }}>
          {heightPx >= 20 && (
            <p className={`text-[10px] font-medium leading-tight text-stone-700 ${isHovered ? 'break-words' : 'truncate'}`}>
              {block.label}
            </p>
          )}
          {heightPx >= 34 && (!hasMatter || heightPx >= 50) && (
            <p className={`text-[9px] leading-tight text-stone-500 ${isHovered ? 'break-words' : 'truncate'}`}>
              {block.subLabel}
            </p>
          )}
          {block.isAggregate && heightPx >= 40 && (!hasMatter || heightPx >= 56) && (
            <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-stone-200/70 px-1 text-[8px] font-semibold text-stone-600">
              {block.stackCount ?? block.itemIds.length} {block.stackCount ? 'activities' : 'signals'}
              {block.stackGroupKey && <ChevronDown size={9} />}
            </span>
          )}
          {matter && matterColor && (
            <div className="mt-0.5 flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-semibold text-white shadow-sm" style={{ backgroundColor: matterColor }}>
              <Briefcase size={7} className="shrink-0" />
              <span className={isHovered ? 'break-words' : 'truncate'}>{matter.name}</span>
            </div>
          )}
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
        <div ref={boardRef} className="relative flex gap-0" style={{ minHeight: effectiveTotalPx + 40 }}>
          {/* Time gutter */}
          <div
            className="sticky left-0 z-20 w-12 shrink-0 bg-stone-50/80 backdrop-blur-sm"
            style={{ height: effectiveTotalPx, transition: `height ${TRANSITION_MS}ms ease-out` }}
          >
            {hours.map((h) => {
              const top = minuteToPx(h * 60);
              const hidden = isHourInCollapsedGap(h * 60);
              return (
                <div
                  key={h}
                  className="absolute right-0"
                  style={{
                    top,
                    transition: `top ${TRANSITION_MS}ms ease-out, opacity ${TRANSITION_MS}ms ease-out`,
                    opacity: hidden ? 0 : 1,
                  }}
                >
                  <span className="absolute -top-1.5 right-1.5 rounded bg-white px-0.5 text-[9px] font-medium text-stone-400">
                    {String(h % 24).padStart(2, '0')}:00
                  </span>
                </div>
              );
            })}
          </div>

          {/* Columns wrapper */}
          <div className="relative flex flex-1">
            {/* Gap band overlay — spans full width of all columns */}
            <div
              className="absolute left-0 right-0 top-0 z-0"
              style={{ height: effectiveTotalPx, transition: `height ${TRANSITION_MS}ms ease-out`, pointerEvents: 'none' }}
            >
              {gapSegments.map((gap) => {
                const isCollapsed = gap.type === 'gap';
                const top = minuteToPx(gap.startMin);
                const duration = gap.endMin - gap.startMin;
                return (
                  <div
                    key={gap.gapId}
                    className={`absolute left-0 right-0 overflow-hidden transition-colors ${
                      isCollapsed
                        ? 'cursor-pointer border-t border-b border-dashed border-stone-300 bg-stone-100/95 hover:bg-stone-200/95 hover:border-stone-400'
                        : 'border-transparent'
                    }`}
                    style={{
                      top,
                      height: isCollapsed ? COLLAPSED_BAND_PX : 0,
                      opacity: isCollapsed ? 1 : 0,
                      pointerEvents: 'none',
                      transition: `top ${TRANSITION_MS}ms ease-out, height ${TRANSITION_MS}ms ease-out, opacity ${TRANSITION_MS}ms ease-out`,
                    }}
                    title={isCollapsed ? `${formatMinutes(duration)} — no activity` : ''}
                  >
                    <div className="flex h-full items-center justify-center gap-1.5">
                      <ChevronDown size={12} className="shrink-0 text-stone-400" />
                      <span className="whitespace-nowrap text-[9px] font-medium text-stone-500">
                        {formatMinutes(duration)} — no activity
                      </span>
                      <ChevronDown size={12} className="shrink-0 text-stone-400" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Columns */}
            {COLUMNS.map((colDef) => {
              const colBlocks = packedColumns[colDef.key];
              const Icon = colDef.icon;
              return (
                <div key={colDef.key} className="relative z-0 flex-1 border-l border-stone-200">
                  {/* Column header */}
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-stone-200 bg-stone-50/90 px-2 py-1.5 backdrop-blur-sm">
                    <Icon size={12} style={{ color: colDef.color }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                      {colDef.label}
                    </span>
                    <span className="ml-auto text-[9px] text-stone-400">{colBlocks.length}</span>
                  </div>

                  {/* Grid */}
                  <div
                    className="relative"
                    style={{ height: effectiveTotalPx, transition: `height ${TRANSITION_MS}ms ease-out` }}
                  >
                    {/* Hour grid lines */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-stone-100"
                        style={{
                          top: minuteToPx(h * 60),
                          transition: `top ${TRANSITION_MS}ms ease-out, opacity ${TRANSITION_MS}ms ease-out`,
                          opacity: isHourInCollapsedGap(h * 60) ? 0 : 1,
                        }}
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
    </div>
  );
}

const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];
