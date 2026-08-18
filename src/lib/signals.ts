import { supabase } from '@/lib/supabase';
import type { BrowserSignal, PairedDevice, WebhookEndpoint, WebhookSignal, ScDocumentSignal } from '@/types/signals';

const SIGNALS_SELECT =
  'id, device_id, day, bucket_start, domain, duration_s, session_count, ' +
  'edited, fields_touched, submits, forms, hints, updated_at';

export async function fetchDaySignals(day: string): Promise<BrowserSignal[]> {
  const { data, error } = await supabase
    .from('browser_signals')
    .select(SIGNALS_SELECT)
    .eq('day', day)
    .order('bucket_start', { ascending: true });
  if (error) return [];
  return (data as BrowserSignal[]) ?? [];
}

export async function fetchRangeSignals(from: string, to: string): Promise<BrowserSignal[]> {
  const { data, error } = await supabase
    .from('browser_signals')
    .select(SIGNALS_SELECT)
    .gte('day', from)
    .lte('day', to)
    .order('day', { ascending: true });
  if (error) return [];
  return (data as BrowserSignal[]) ?? [];
}

export async function fetchDevices(): Promise<PairedDevice[]> {
  const { data, error } = await supabase
    .from('daykeeper_devices')
    .select('id, label, created_at, last_seen_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data as PairedDevice[]) ?? [];
}

export async function issueDeviceToken(label: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('daykeeper_issue_device_token', {
    p_label: label,
  });
  if (error) return null;
  return data as string | null;
}

export async function revokeDevice(deviceId: string): Promise<boolean> {
  const { error } = await supabase
    .from('daykeeper_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId);
  return !error;
}

export async function deleteDaySignals(day: string): Promise<boolean> {
  const { error } = await supabase.from('browser_signals').delete().eq('day', day);
  return !error;
}

export async function deleteAllSignals(): Promise<boolean> {
  const { error } = await supabase.from('browser_signals').delete().neq('id', 0);
  return !error;
}

/**
 * Subscribe to realtime upserts on browser_signals for a given day.
 * Returns an unsubscribe function. The callback receives the updated
 * row — callers must REPLACE by id, never add duration_s to an existing value.
 */
export function subscribeToDaySignals(
  day: string,
  onUpsert: (row: BrowserSignal) => void,
): () => void {
  const channel = supabase
    .channel(`browser-signals-${day}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'browser_signals', filter: `day=eq.${day}` },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          onUpsert(payload.new as BrowserSignal);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Webhook endpoints & signals ──────────────────────────────────────────────

export async function fetchWebhookEndpoints(): Promise<WebhookEndpoint[]> {
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .select('id, label, last_used_at, created_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data as WebhookEndpoint[]) ?? [];
}

export async function issueWebhookToken(label: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('daykeeper_issue_webhook_token', {
    p_label: label,
  });
  if (error) return null;
  return data as string | null;
}

export async function revokeWebhookEndpoint(endpointId: string): Promise<boolean> {
  const { error } = await supabase.rpc('daykeeper_revoke_webhook_endpoint', {
    p_endpoint_id: endpointId,
  });
  return !error;
}

export async function fetchWebhookSignals(day: string): Promise<WebhookSignal[]> {
  const { data, error } = await supabase
    .from('webhook_signals')
    .select('id, endpoint_id, day, timestamp, summary, duration_minutes, end_timestamp, source, meta, external_id, created_at')
    .eq('day', day)
    .order('timestamp', { ascending: true });
  if (error) return [];
  return (data as WebhookSignal[]) ?? [];
}

export function subscribeToWebhookSignals(
  day: string,
  onUpsert: (row: WebhookSignal) => void,
): () => void {
  const channel = supabase
    .channel(`webhook-signals-${day}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'webhook_signals', filter: `day=eq.${day}` },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          onUpsert(payload.new as WebhookSignal);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── SingleCase document-editing signals ─────────────────────────────────────

const SC_DOC_SIGNALS_SELECT =
  'id, user_id, day, timestamp, end_timestamp, duration_minutes, file_name, ' +
  'case_id, case_name, case_id_visible, word_count, revision_count, summary, meta, created_at';

export async function fetchScDocumentSignals(day: string): Promise<ScDocumentSignal[]> {
  const { data, error } = await supabase
    .from('sc_document_signals')
    .select(SC_DOC_SIGNALS_SELECT)
    .eq('day', day)
    .order('timestamp', { ascending: true });
  if (error) return [];
  return (data as ScDocumentSignal[]) ?? [];
}

export function subscribeToScDocumentSignals(
  day: string,
  onUpsert: (row: ScDocumentSignal) => void,
): () => void {
  const channel = supabase
    .channel(`sc-doc-signals-${day}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sc_document_signals', filter: `day=eq.${day}` },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          onUpsert(payload.new as ScDocumentSignal);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function insertScDocumentSignal(signal: {
  day: string;
  timestamp: string;
  end_timestamp: string | null;
  duration_minutes: number;
  file_name: string;
  case_id: string | null;
  case_name: string | null;
  case_id_visible: string | null;
  word_count: number;
  revision_count: number;
  summary: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from('sc_document_signals').insert({
    day: signal.day,
    timestamp: signal.timestamp,
    end_timestamp: signal.end_timestamp,
    duration_minutes: signal.duration_minutes,
    file_name: signal.file_name,
    case_id: signal.case_id,
    case_name: signal.case_name,
    case_id_visible: signal.case_id_visible,
    word_count: signal.word_count,
    revision_count: signal.revision_count,
    summary: signal.summary,
  });
  return !error;
}
