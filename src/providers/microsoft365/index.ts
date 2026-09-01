import type {
  ActivityItem,
  ActivityProvider,
  ActivityMeta,
  Provider,
  DateRange,
} from '@/types';
import { supabase } from '@/lib/supabase';

let ms365LastError: string | null = null;

export function getMs365LastError(): string | null {
  return ms365LastError;
}

export function clearMs365LastError(): void {
  ms365LastError = null;
}

interface Ms365GraphItem {
  id: string;
  provider: 'email' | 'calendar';
  timestamp: string;
  endTimestamp?: string;
  durationMinutes?: number;
  summary: string;
  meta: {
    sender?: string;
    recipient?: string;
    subject?: string;
    threadId?: string;
    direction?: 'incoming' | 'outgoing';
    title?: string;
    attendeeCount?: number;
    accepted?: boolean;
    bodySnippet?: string;
  };
}

export interface Ms365ProviderData {
  provider: ActivityProvider;
  upn: string | null;
}

export async function createMs365Provider(userUpn?: string): Promise<Ms365ProviderData | null> {
  const upn = userUpn ?? null;

  const provider: ActivityProvider = {
    provider: 'email' as Provider,
    label: 'Microsoft 365',
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      if (!upn) return [];

      const date = dateRange.start.slice(0, 10);
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return [];

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ms365-fetch`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ action: 'fetch', date, upn }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody.error ?? `HTTP ${response.status}`;
        console.error('MS365 fetch failed:', response.status, errBody);
        ms365LastError = msg;
        return [];
      }

      const result = await response.json();
      if (!result.ok || !Array.isArray(result.items)) {
        ms365LastError = result.error ?? 'Unknown error';
        return [];
      }

      if (result.errors && result.errors.length > 0) {
        ms365LastError = result.errors.join('; ');
        console.warn('MS365 partial errors:', result.errors);
      } else {
        ms365LastError = null;
      }

      return (result.items as Ms365GraphItem[]).map((item) => toActivityItem(item));
    },
  };

  return { provider, upn };
}

function toActivityItem(item: Ms365GraphItem): ActivityItem {
  const meta: ActivityMeta = {
    sender: item.meta.sender,
    recipient: item.meta.recipient,
    subject: item.meta.subject,
    threadId: item.meta.threadId,
    direction: item.meta.direction,
    title: item.meta.title,
    attendeeCount: item.meta.attendeeCount,
    accepted: item.meta.accepted,
    bodySnippet: item.meta.bodySnippet,
  };

  return {
    id: item.id,
    provider: item.provider as Provider,
    timestamp: item.timestamp,
    endTimestamp: item.endTimestamp,
    durationMinutes: item.durationMinutes,
    summary: item.summary,
    meta,
  };
}
