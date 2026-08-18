// Core domain types for Daykeeper.
// Activity data is NEVER persisted — these types describe the in-memory shape
// fetched from providers and used to generate timesheet entries.

export type Provider = 'email' | 'calendar' | 'chat' | 'documents' | 'singlecase' | 'custom' | 'browser' | 'webhook';

export type CustomConnectorAuthType = 'api_key' | 'bearer' | 'basic' | 'none';

export interface CustomConnector {
  id: string;
  org_id: string;
  name: string;
  icon_key: string;
  auth_type: CustomConnectorAuthType;
  base_url: string;
  endpoint_path: string;
  http_method: 'GET' | 'POST';
  date_param_name: string;
  date_param_format: 'iso' | 'unix' | 'YYYY-MM-DD';
  end_date_param_name: string | null;
  response_items_path: string | null;
  field_mapping: CustomConnectorFieldMapping;
  extra_headers: Record<string, string>;
  status: 'active' | 'inactive';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomConnectorFieldMapping {
  id?: string;
  timestamp?: string;
  summary?: string;
  durationMinutes?: string;
  endTimestamp?: string;
  meta?: {
    sender?: string;
    subject?: string;
    threadId?: string;
    title?: string;
    channel?: string;
    fileName?: string;
  };
}

export type Confidence = 'low' | 'medium' | 'high';

export type MatterConfidence = 'confirmed' | 'high' | 'medium' | 'low' | 'unassigned';

export type AttributionSource = 'estimator' | 'singlecase' | 'manual' | 'manual_override';

export type RoundingMinutes = 0 | 6 | 15;

export type OutputLanguage = 'cs' | 'en';

export type ConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'needs_admin_approval'
  | 'needs_reauth'
  | 'error';

export type ExclusionRuleType = 'email_domain' | 'chat_channel' | 'calendar_keyword';

export type MatterRuleType =
  | 'email_address'
  | 'email_domain'
  | 'chat_channel'
  | 'file_path_prefix'
  | 'task_project'
  | 'calendar_series'
  | 'keyword';

export type OrgRole = 'admin' | 'member';

export type CaseLanguage = 'ces' | 'eng' | 'other';

export interface DateRange {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

// A single unit of activity fetched from a provider. Metadata only — never
// includes email bodies, chat message text, or document contents.
export interface ActivityItem {
  id: string;
  provider: Provider;
  timestamp: string; // ISO 8601
  summary: string;
  durationMinutes?: number;
  endTimestamp?: string;
  meta: ActivityMeta;
}

export interface ActivityMeta {
  // Email
  sender?: string;
  recipient?: string;
  subject?: string;
  threadId?: string;
  direction?: 'incoming' | 'outgoing';
  wordCount?: number;
  bodySnippet?: string; // first ~500 chars of plain-text body, for matter matching
  // Calendar
  title?: string;
  attendeeCount?: number;
  accepted?: boolean;
  // Chat
  channel?: string;
  messageCount?: number;
  // Tasks
  ticketKey?: string;
  ticketTitle?: string;
  taskEventType?: 'comment' | 'status_change' | 'worklog';
  // Documents
  fileName?: string;
  revisionCount?: number;
  // Custom connector
  url?: string;
  // SingleCase
  caseId?: string;
  caseName?: string;
  caseIdVisible?: string;
  scActivityKind?: 'document' | 'note' | 'email_filed' | 'task';
  noteTitle?: string;
  isAlreadyRecorded?: boolean;
  possibleDuplicate?: boolean;
}

export interface ActivityProvider {
  readonly provider: Provider;
  readonly label: string;
  fetchActivity(dateRange: DateRange): Promise<ActivityItem[]>;
}

// --- Organization model (persisted) ---

export interface Organization {
  id: string;
  name: string;
  singlecase_base_url: string | null;
  workspace_subdomain: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  singlecase_user_id: string | null;
  joined_at: string;
}

export interface OrganizationInvite {
  id: string;
  org_id: string;
  email: string;
  token: string;
  role: OrgRole;
  created_by: string | null;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
}

// --- SingleCase reference data (org-scoped, persisted) ---

export interface Client {
  id: string;
  org_id: string;
  external_id: string;
  name: string;
  primary_domain: string | null;
  synced_at: string;
}

export interface Matter {
  id: string;
  org_id: string;
  external_id: string;
  case_id_visible: string | null;
  name: string;
  client_external_id: string | null;
  parent_external_id: string | null;
  project_state_id: string | null;
  state_is_open: boolean;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  language: CaseLanguage;
  currency: string | null;
  case_no: string | null;
  court_case_no: string | null;
  custom_fields: Record<string, unknown>;
  is_internal: boolean;
  last_activity_at: string | null;
  synced_at: string;
}

export interface Contact {
  id: string;
  org_id: string;
  external_id: string;
  display_name: string;
  emails: string[];
  synced_at: string;
}

export interface MatterContact {
  id: string;
  org_id: string;
  matter_id: string;
  contact_external_id: string;
  role: 'contact' | 'adversary';
}

export interface ActivityType {
  id: string;
  org_id: string;
  external_id: string;
  label: string;
  sort_order: number;
}

export interface EmailMatterLookup {
  id: string;
  org_id: string;
  email_address: string;
  email_domain: string;
  matter_id: string;
  contact_external_id: string | null;
}

// --- Personal data (user-scoped, persisted) ---

export interface MatterRule {
  id: string;
  user_id: string;
  matter_id: string | null;
  rule_type: MatterRuleType;
  value: string;
  created_at: string;
  hit_count: number;
  source: 'user_confirmed' | 'imported';
}

export interface ManualEntry {
  id: string;
  user_id: string;
  work_date: string;
  start_time: string | null;
  duration_minutes: number;
  description: string;
  activity_type: string | null;
  matter_id: string | null;
  created_at: string;
}

// --- Existing persisted types ---

export interface Profile {
  user_id: string;
  display_name: string | null;
  timezone: string;
  working_hours_start: string;
  working_hours_end: string;
  rounding_minutes: RoundingMinutes;
  target_hours: number;
  output_language: OutputLanguage;
  onboarded: boolean;
  demo_mode: boolean;
  created_at: string;
  org_id: string | null;
  org_role: OrgRole;
}

export interface Connection {
  id: string;
  user_id: string;
  provider: Provider;
  status: ConnectionStatus;
  account_label: string | null;
  scopes_granted: string[];
  connected_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  workspace_subdomain: string | null;
  connection_metadata: Record<string, unknown>;
}

export interface ActivityTypeOption {
  id: string;
  user_id: string;
  label: string;
  sort_order: number;
}

export interface ExclusionRule {
  id: string;
  user_id: string;
  rule_type: ExclusionRuleType;
  value: string;
}

export interface Timesheet {
  id: string;
  user_id: string;
  work_date: string;
  status: 'draft' | 'final';
  model_used: string | null;
  generated_at: string;
  source_providers: Provider[];
  total_minutes: number;
}

export interface TimesheetEntry {
  id: string;
  timesheet_id: string;
  user_id: string;
  sort_order: number;
  description: string;
  suggested_minutes: number;
  confirmed_minutes: number;
  activity_type: string | null;
  billable: boolean;
  confidence: Confidence;
  source_summary: string | null;
  matter_id: string | null;
  matter_confidence: MatterConfidence;
  matter_reason: string | null;
  attribution_source: AttributionSource;
  manual_entry_id: string | null;
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  action: string;
  provider: Provider | null;
  occurred_at: string;
  detail: string | null;
}

// --- Generated timesheet (in-memory, before saving) ---

export interface DraftTimesheetEntry {
  id: string;
  description: string;
  suggestedMinutes: number;
  confirmedMinutes: number;
  activityType: string | null;
  billable: boolean;
  confidence: Confidence;
  sourceSummary: string;
  sourceItemIds: string[];
  matterId: string | null;
  matterConfidence: MatterConfidence;
  matterReason: string | null;
  attributionSource: AttributionSource;
  manualEntryId: string | null;
}

// --- Matter attribution result ---

export interface AttributionResult {
  matterId: string | null;
  confidence: MatterConfidence;
  reason: string;
  source: AttributionSource;
}
