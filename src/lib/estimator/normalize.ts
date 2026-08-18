import type { ActivityItem, Provider } from '@/types';
import type { NormalizedItem } from './types';

// Parse a local timestamp string "YYYY-MM-DDTHH:mm:ss" into minutes since midnight.
function toMinutes(isoLocal: string): number {
  const time = isoLocal.slice(11, 16); // "HH:mm"
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Stage 1: Normalize
// Every activity item becomes { id, provider, kind, start, end, weight, label, groupKey }
// in the user's timezone. Timestamps are converted to minutes since midnight.
export function normalize(items: ActivityItem[]): NormalizedItem[] {
  return items.map((item) => normalizeOne(item));
}

function normalizeOne(item: ActivityItem): NormalizedItem {
  const start = toMinutes(item.timestamp);
  const end = item.endTimestamp
    ? toMinutes(item.endTimestamp)
    : start + (item.durationMinutes ?? 1);

  const { kind, weight, label, groupKey } = deriveKindWeightLabel(item);

  return {
    id: item.id,
    provider: item.provider,
    kind,
    start,
    end: Math.max(end, start + 1),
    weight,
    label,
    groupKey,
    meta: item.meta,
    startIso: item.timestamp,
    endIso: item.endTimestamp ?? item.timestamp,
  };
}

function deriveKindWeightLabel(
  item: ActivityItem,
): { kind: string; weight: number; label: string; groupKey: string } {
  const m = item.meta;

  switch (item.provider) {
    case 'calendar': {
      const accepted = m.accepted !== false;
      const kind = accepted ? 'calendar.accepted' : 'calendar.declined';
      const weight = 0; // calendar uses actual span, not weight
      const label = m.title ?? item.summary;
      const groupKey = item.id; // each event is its own session
      return { kind, weight, label, groupKey };
    }

    case 'email': {
      const sent = m.direction === 'outgoing';
      const kind = sent ? 'email.sent' : 'email.received';
      const weight = sent ? 6 : m.threadId ? 2 : 1;
      const label = m.subject ?? item.summary;
      const groupKey = m.threadId ?? item.id;
      return { kind, weight, label, groupKey };
    }

    case 'chat': {
      const kind = 'chat.message';
      const weight = 0; // chat uses span, not per-message weight
      const label = m.channel ?? item.summary;
      const groupKey = m.channel ?? item.id;
      return { kind, weight, label, groupKey };
    }

    case 'documents': {
      const kind = 'documents.session';
      const weight = 0; // documents use span
      const label = m.fileName ?? item.summary;
      const groupKey = m.fileName ?? item.id;
      return { kind, weight, label, groupKey };
    }

    case 'singlecase': {
      const kind = `singlecase.${m.scActivityKind ?? 'activity'}`;
      const weight = 0;
      const label = m.caseName ?? item.summary;
      const groupKey = m.caseId ?? item.id;
      return { kind, weight, label, groupKey };
    }

    case 'browser': {
      const kind = 'browser.session';
      const weight = 0; // uses span from duration_s
      const label = item.summary;
      const groupKey = m.fileName ?? item.id; // fileName holds the domain
      return { kind, weight, label, groupKey };
    }

    default:
      return { kind: 'unknown', weight: 1, label: item.summary, groupKey: item.id };
  }
}
