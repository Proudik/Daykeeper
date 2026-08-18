import { useMemo } from 'react';
import type { ActivityItem, Provider } from '@/types';
import { formatMinutes, minutesBetween, parseHHmm, timestampToMinutes } from '@/lib/time';

const PROVIDER_COLORS: Record<Provider, string> = {
  email: '#2563eb',
  calendar: '#dc2626',
  chat: '#059669',
  documents: '#7c3aed',
  singlecase: '#0891b2',
  browser: '#0d9488',
  custom: '#ea580c',
  webhook: '#d97706',
};

interface TimelineEntry {
  item: ActivityItem;
  startMin: number;
  endMin: number;
  topPx: number;
  heightPx: number;
  lane: number;
  laneCount: number;
}

interface VerticalTimelineProps {
  items: ActivityItem[];
  timezone?: string;
  workStart: string;
  workEnd: string;
  usedItemIds?: Set<string>;
  generatedItemIds?: Set<string>;
}

const HOUR_PX = 56;
const MIN_DURATION_MIN = 10;

function durationOf(item: ActivityItem, timezone?: string): number {
  if (item.endTimestamp) return minutesBetween(item.timestamp, item.endTimestamp, timezone);
  return item.durationMinutes ?? 0;
}

function assignLanes(items: ActivityItem[], timezone?: string): TimelineEntry[] {
  const raw = items.map((item) => {
    const startMin = timestampToMinutes(item.timestamp, timezone);
    const endMin = Math.max(startMin + Math.max(durationOf(item, timezone), 3), startMin + 3);
    return { item, startMin, endMin };
  }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const laneEnds: number[] = [];
  const assigned = raw.map((entry) => {
    const lane = laneEnds.findIndex((end) => end <= entry.startMin);
    const laneIndex = lane === -1 ? laneEnds.length : lane;
    laneEnds[laneIndex] = entry.endMin;
    return { ...entry, lane: laneIndex };
  });

  const laneCount = Math.max(laneEnds.length, 1);
  return assigned.map((entry) => ({
    ...entry,
    topPx: 28 + ((entry.startMin - 0) % (24 * 60)) / 60 * HOUR_PX,
    heightPx: Math.max(5, ((entry.endMin - entry.startMin) / 60) * HOUR_PX),
    laneCount,
  }));
}

export function VerticalTimeline({
  items,
  timezone,
  workStart,
  workEnd,
  usedItemIds,
  generatedItemIds,
}: VerticalTimelineProps) {
  const startMin = parseHHmm(workStart);
  const endMin = Math.max(parseHHmm(workEnd), startMin + 60);
  const displayStart = Math.floor(startMin / 60) * 60;
  const displayEnd = Math.ceil(endMin / 60) * 60;
  const totalPx = ((displayEnd - displayStart) / 60) * HOUR_PX + 28;

  const entries = useMemo(() => {
    const filtered = items.filter((item) => item.provider === 'email' || durationOf(item, timezone) >= MIN_DURATION_MIN);
    return assignLanes(filtered, timezone).map((entry) => ({
      ...entry,
      topPx: 28 + ((entry.startMin - displayStart) / 60) * HOUR_PX,
    })).filter((entry) => entry.topPx + entry.heightPx > 28 && entry.topPx < totalPx);
  }, [items, timezone, displayStart, totalPx]);

  const hours = Array.from({ length: Math.floor((displayEnd - displayStart) / 60) + 1 }, (_, i) => displayStart / 60 + i);

  return (
    <div className="relative w-full select-none" style={{ height: totalPx }}>
      {hours.map((hour) => (
        <div key={hour} className="absolute left-0 right-0 border-t border-stone-100" style={{ top: 28 + (hour * 60 - displayStart) / 60 * HOUR_PX }}>
          <span className="absolute -top-2 left-2 rounded bg-white px-0.5 text-[9px] font-medium text-stone-400">
            {String(hour % 24).padStart(2, '0')}:00
          </span>
        </div>
      ))}
      {entries.map((entry) => {
        const used = usedItemIds?.has(entry.item.id) ?? false;
        const inTimesheet = generatedItemIds?.has(entry.item.id) ?? false;
        const color = PROVIDER_COLORS[entry.item.provider] ?? '#78716c';
        const width = Math.max(36, 100 / entry.laneCount - 4);
        const left = (entry.lane * 100) / entry.laneCount + 2;
        const overlapping = entry.laneCount > 1;
        const canShowTitle = (entry.item.provider === 'singlecase' && entry.item.meta.scActivityKind === 'document')
          ? entry.heightPx >= 16 && width > 40
          : entry.heightPx >= 22 && width > 52;
        return (
          <div
            key={entry.item.id}
            className={`absolute overflow-hidden rounded-md border text-left transition-opacity duration-150 ${used ? 'opacity-50' : inTimesheet ? 'opacity-100' : 'opacity-60'}`}
            style={{ top: entry.topPx, height: entry.heightPx, left: `${left}%`, width: `${width}%`, borderColor: color, backgroundColor: inTimesheet ? `${color}44` : `${color}22` }}
            title={`${entry.item.summary} · ${formatMinutes(durationOf(entry.item, timezone))}${used ? ' · Already used' : ''}${inTimesheet ? ' · In timesheet' : ''}`}
          >
            <span className="block h-full border-l-[3px] px-1.5" style={{ borderColor: color }}>
              {canShowTitle && <span className="block truncate text-[10px] font-medium text-stone-700">{entry.item.summary}</span>}
              {used && <span className="absolute right-1 top-0.5 text-[8px] font-bold text-emerald-600">✓</span>}
              {overlapping && entry.heightPx < 22 && <span className="block text-[8px] font-bold" style={{ color }}>+</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
