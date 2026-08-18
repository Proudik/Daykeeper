import type { ActivityItem, ActivityProvider, DateRange, Provider } from '@/types';
import { supabase } from '@/lib/supabase';

let customError: string | null = null;

export function getCustomError(): string | null {
  return customError;
}

export function clearCustomError(): void {
  customError = null;
}

export interface CustomProviderData {
  provider: Provider;
  label: string;
  connectorId: string;
  connectorName: string;
  fetchActivity(dateRange: DateRange): Promise<ActivityItem[]>;
}

export function createCustomProvider(connectorId: string, connectorName: string): CustomProviderData {
  return {
    provider: 'custom' as Provider,
    label: connectorName,
    connectorId,
    connectorName,
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      customError = null;
      try {
        const { data } = await supabase.auth.getSession();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/custom-fetch`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session?.access_token ?? ''}`,
          },
          body: JSON.stringify({
            action: 'fetch',
            connector_id: connectorId,
            date_range: dateRange,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          customError = result.error ?? 'Failed to fetch custom connector activity';
          return [];
        }
        return (result.items as ActivityItem[]) ?? [];
      } catch {
        customError = 'Network error — could not reach the server';
        return [];
      }
    },
  };
}
