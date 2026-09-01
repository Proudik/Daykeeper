import type { ActivityItem, Provider } from '@/types';
import { timestampToMinutes, minutesBetween } from '@/lib/time';

interface TimelineStripProps {
  items: ActivityItem[];
  workStart: string; // "HH:mm"
  workEnd: string; // "HH:mm"
}

const providerColors: Record<Provider, string> = {
  email: '#2563eb',
  calendar: '#dc2626',
  chat: '#059669',
  documents: '#7c3aed',
  singlecase: '#0891b2',
  browser: '#0d9488',
  custom: '#ea580c',
};

// Compute overlap lanes so overlapping blocks stack visually.
interface TimelineBlock {
  item: ActivityItem;
  startMin: number;
  endMin: number;
  lane: number;
}

function assignLanes(items: ActivityItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = items.map((item) => {
    const startMin = timestampToMinutes(item.timestamp);
    const endMin = item.endTimestamp
      ? timestampToMinutes(item.endTimestamp)
      : startMin + (item.durationMinutes ?? 5);
    return { item, startMin, endMin: Math.max(endMin, startMin + 3), lane: 0 };
  });
  blocks.sort((a, b) => a.startMin - b.startMin);

  const lanes: number[] = []; // each lane holds the end time of its last block
  for (const block of blocks) {
    let assigned = false;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] <= block.startMin) {
        block.lane = i;
        lanes[i] = block.endMin;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      block.lane = lanes.length;
      lanes.push(block.endMin);
    }
  }
  return blocks;
}

export function TimelineStrip({ items, workStart, workEnd }: TimelineStripProps) {
  const startMin = parseHHmm(workStart);
  const endMin = parseHHmm(workEnd);
  const span = Math.max(endMin - startMin, 60);

  const blocks = assignLanes(items);
  const maxLane = blocks.reduce((max, b) => Math.max(max, b.lane), 0);
  const laneCount = maxLane + 1;
  const stripHeight = Math.max(28, laneCount * 14 + 8);

  // Hour markers
  const hours: number[] = [];
  for (let h = Math.floor(startMin / 60); h * 60 < endMin; h++) {
    hours.push(h);
  }

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
          Timeline
        </span>
        <div className="flex items-center gap-3 text-xs text-stone-500">
          {(['browser', 'email', 'calendar', 'chat', 'documents', 'singlecase'] as Provider[]).map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: providerColors[p] }}
              />
              <span className="capitalize">{p}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative" style={{ height: stripHeight }}>
        {/* Hour grid lines + labels */}
        {hours.map((h, hIdx) => {
          const left = ((h * 60 - startMin) / span) * 100;
          if (left < 0 || left > 100) return null;
          const isLast = hIdx === hours.length - 1;
          return (
            <div
              key={h}
              className="absolute top-0 bottom-0 border-l border-stone-200"
              style={{ left: `${left}%` }}
            >
              <span
                className="absolute -top-0.5 text-[10px] text-stone-400 whitespace-nowrap"
                style={{ left: isLast ? 'auto' : '2px', right: isLast ? '0' : 'auto' }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          );
        })}

        {/* Blocks */}
        {blocks.map((block) => {
          const left = ((block.startMin - startMin) / span) * 100;
          const width = Math.max(((block.endMin - block.startMin) / span) * 100, 0.5);
          const top = block.lane * 14 + 4;
          const color = providerColors[block.item.provider];
          const isDeclined = block.item.provider === 'calendar' && block.item.meta.accepted === false;
          return (
            <div
              key={block.item.id}
              className="absolute rounded-sm"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: `${top}px`,
                height: '10px',
                backgroundColor: color,
                opacity: isDeclined ? 0.35 : 0.85,
                border: isDeclined ? '1px dashed rgba(255,255,255,0.6)' : 'none',
              }}
              title={`${block.item.summary} (${formatRange(block)})`}
            />
          );
        })}
      </div>
    </div>
  );
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatRange(block: TimelineBlock): string {
  const fmt = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return `${fmt(block.startMin)}–${fmt(block.endMin)}`;
}

export { providerColors, minutesBetween };
