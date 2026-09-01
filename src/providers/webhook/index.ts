import type { ActivityItem, ActivityProvider, DateRange, Provider } from '@/types';
import type { WebhookSignal } from '@/types/signals';
import { fetchWebhookSignals } from '@/lib/signals';

export interface WebhookProviderData {
  provider: ActivityProvider;
}

export function createWebhookProvider(timezone: string): WebhookProviderData {
  const provider: ActivityProvider = {
    provider: 'webhook' as Provider,
    label: 'Webhook',
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      const day = dateRange.start.slice(0, 10);
      const signals = await fetchWebhookSignals(day);
      return signalsToActivityItems(signals, timezone);
    },
  };

  return { provider };
}

function signalsToActivityItems(signals: WebhookSignal[], _timezone: string): ActivityItem[] {
  if (signals.length === 0) return [];

  // Group by external_id if present, otherwise each signal is its own item
  const byExternal = new Map<string, WebhookSignal[]>();

  for (const s of signals) {
    const key = s.external_id ?? s.id;
    const list = byExternal.get(key) ?? [];
    list.push(s);
    byExternal.set(key, list);
  }

  const items: ActivityItem[] = [];

  for (const [, group] of byExternal) {
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = group[0];

    const meta: Record<string, string> = {};
    if (first.source) meta.source = first.source;
    if (first.external_id) meta.threadId = first.external_id;

    // Extract common meta fields
    const m = first.meta ?? {};
    if (typeof m.sender === 'string') meta.sender = m.sender;
    if (typeof m.subject === 'string') meta.subject = m.subject;
    if (typeof m.channel === 'string') meta.channel = m.channel;
    if (typeof m.fileName === 'string') meta.fileName = m.fileName;
    if (typeof m.title === 'string') meta.title = m.title;

    items.push({
      id: `webhook-${first.id}`,
      provider: 'webhook' as Provider,
      timestamp: first.timestamp,
      durationMinutes: first.duration_minutes || undefined,
      endTimestamp: first.end_timestamp ?? undefined,
      summary: first.summary,
      meta,
    });
  }

  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return items;
}
