import type { ActivityItem, ActivityProvider, DateRange, Provider } from '@/types';
import type { BrowserSignal } from '@/types/signals';
import { fetchDaySignals } from '@/lib/signals';

export interface BrowserProviderData {
  provider: ActivityProvider;
  signals: BrowserSignal[];
}

/**
 * Creates a browser-signal provider that reads from the browser_signals
 * table and converts rollups into ActivityItems grouped by domain.
 *
 * The extension sends 15-minute rollups throughout the day, so a single
 * domain like "github.com" may produce many rows. We merge them into one
 * ActivityItem per domain with the total duration summed and the
 * individual time slots stored in meta.bodySnippet for the UI to display.
 */
export function createBrowserProvider(timezone: string): BrowserProviderData {
  const provider: ActivityProvider = {
    provider: 'browser' as Provider,
    label: 'Browser',
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      const day = dateRange.start.slice(0, 10);
      const signals = await fetchDaySignals(day);
      return groupSignalsByDomain(signals, timezone);
    },
  };

  return { provider, signals: [] };
}

export interface BrowserTimeSlot {
  time: string;       // ISO timestamp of bucket_start
  duration_s: number;
}

/**
 * Merge all signals for the same domain into a single ActivityItem.
 * The item's timestamp is the earliest bucket for that domain, and
 * durationMinutes is the sum of all buckets. Individual slots are
 * stored in meta.bodySnippet as JSON for the UI to render as expandable
 * detail.
 */
function groupSignalsByDomain(signals: BrowserSignal[], _timezone: string): ActivityItem[] {
  const byDomain = new Map<string, BrowserSignal[]>();

  for (const s of signals) {
    const list = byDomain.get(s.domain) ?? [];
    list.push(s);
    byDomain.set(s.domain, list);
  }

  const items: ActivityItem[] = [];

  for (const [domain, group] of byDomain) {
    // Sort by bucket_start so earliest is first
    group.sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));

    const totalDurationS = group.reduce((sum, s) => sum + s.duration_s, 0);
    const totalSessions = group.reduce((sum, s) => sum + s.session_count, 0);
    const totalFieldsTouched = group.reduce((sum, s) => sum + s.fields_touched, 0);
    const totalSubmits = group.reduce((sum, s) => sum + s.submits, 0);
    const totalForms = group.reduce((sum, s) => sum + s.forms, 0);
    const anyEdited = group.some((s) => s.edited);

    // Collect all hints across buckets, deduplicated by title
    const seenTitles = new Set<string>();
    const hintTitles: string[] = [];
    for (const s of group) {
      const parsed = parseHints(s.hints);
      for (const h of parsed) {
        if (h.title && !seenTitles.has(h.title)) {
          seenTitles.add(h.title);
          hintTitles.push(h.title);
        }
      }
    }

    const slots: BrowserTimeSlot[] = group.map((s) => ({
      time: s.bucket_start,
      duration_s: s.duration_s,
    }));

    const earliest = group[0].bucket_start;
    const durationMinutes = Math.round(totalDurationS / 60);

    // Use the most specific page title if available, otherwise the domain
    const summary = hintTitles[0] ?? domain;

    items.push({
      id: `browser-${domain}`,
      provider: 'browser' as Provider,
      timestamp: earliest,
      durationMinutes: Math.max(durationMinutes, 1),
      endTimestamp: undefined,
      summary,
      meta: {
        fileName: domain,
        bodySnippet: JSON.stringify({
          domain,
          slots,
          slotCount: slots.length,
          hints: hintTitles.slice(0, 5),
          forms: totalForms,
          edited: anyEdited,
          submits: totalSubmits,
          fields_touched: totalFieldsTouched,
          session_count: totalSessions,
        }),
      },
    });
  }

  // Sort by earliest timestamp
  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return items;
}

function parseHints(raw: string | null): { path: string | null; title: string | null }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

/**
 * Extracts the structured metadata that groupSignalsByDomain stuffed into
 * meta.bodySnippet. Used by the UI to render expandable time-slot detail.
 */
export function getBrowserItemMeta(item: ActivityItem): {
  domain: string;
  slots: BrowserTimeSlot[];
  slotCount: number;
  hints: string[];
  forms: number;
  edited: boolean;
  submits: number;
  fields_touched: number;
  session_count: number;
} | null {
  if (item.provider !== 'browser' || !item.meta.bodySnippet) return null;
  try {
    const parsed = JSON.parse(item.meta.bodySnippet);
    if (parsed && typeof parsed.domain === 'string' && Array.isArray(parsed.slots)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
