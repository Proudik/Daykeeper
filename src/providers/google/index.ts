import type {
  ActivityItem,
  ActivityProvider,
  ActivityMeta,
  Provider,
  DateRange,
} from '@/types';
import { supabase } from '@/lib/supabase';

let googleLastError: string | null = null;

export function getGoogleLastError(): string | null {
  return googleLastError;
}

export function clearGoogleLastError(): void {
  googleLastError = null;
}

interface GoogleGraphItem {
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

export interface GoogleProviderData {
  provider: ActivityProvider;
  email: string | null;
}

export async function createGoogleProvider(userEmail?: string): Promise<GoogleProviderData | null> {
  const email = userEmail ?? null;

  const provider: ActivityProvider = {
    provider: 'email' as Provider,
    label: 'Google',
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      const date = dateRange.start.slice(0, 10);
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return [];

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-fetch`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ action: 'fetch', date, user_email: email }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody.error ?? `HTTP ${response.status}`;
        console.error('Google fetch failed:', response.status, errBody);
        googleLastError = msg;
        return [];
      }

      const result = await response.json();
      if (!result.ok || !Array.isArray(result.items)) {
        googleLastError = result.error ?? 'Unknown error';
        return [];
      }

      if (result.errors && result.errors.length > 0) {
        googleLastError = result.errors.join('; ');
        console.warn('Google partial errors:', result.errors);
      } else {
        googleLastError = null;
      }

      return (result.items as GoogleGraphItem[]).map((item) => toActivityItem(item));
    },
  };

  return { provider, email };
}

function toActivityItem(item: GoogleGraphItem): ActivityItem {
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
