export type SignalHint = { path: string | null; title: string | null };

export type BrowserSignal = {
  id: string;
  device_id: string;
  day: string;           // 'YYYY-MM-DD' local calendar day — ALWAYS group by this
  bucket_start: string;  // ISO UTC instant — for ordering and overlap tests only
  domain: string;
  duration_s: number;
  session_count: number;
  edited: boolean;
  fields_touched: number;
  submits: number;
  forms: number;
  hints: string | null;
  updated_at: string;
};

export type PairedDevice = {
  id: string;
  label: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type BridgeState = 'unsupported' | 'not_installed' | 'installed_unpaired' | 'paired';

export type ExtensionStatus = {
  ok: true;
  version: string;
  paired: boolean;
  paused: boolean;
  recording: boolean;
  device_id: string;
  today_ms: number;
  last_flush: { ok: boolean; sent?: number; reason?: string; at: number } | null;
  mode: 'all' | 'allowlist';
};

export type PairResult =
  | { ok: true; device_id: string; first_send: { ok: boolean; sent?: number; reason?: string } }
  | { ok: false; error: 'host_permission_required'; options_url: string };

export type WebhookEndpoint = {
  id: string;
  label: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type WebhookSignal = {
  id: string;
  endpoint_id: string;
  day: string;
  timestamp: string;
  summary: string;
  duration_minutes: number;
  end_timestamp: string | null;
  source: string | null;
  meta: Record<string, unknown>;
  external_id: string | null;
  created_at: string;
};

export type ScDocumentSignal = {
  id: string;
  user_id: string;
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
  meta: Record<string, unknown> | null;
  created_at: string;
};
