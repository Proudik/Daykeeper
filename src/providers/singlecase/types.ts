// SingleCase public API payload types.
// Tenant-hosted at https://{workspace}.singlecase.cz/publicapi/v1/...
// These mirror the confirmed API response shapes so the mock and the eventual
// live client are interchangeable.

// --- Auth ---
export interface SingleCaseToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// --- Users ---
export interface SingleCaseUser {
  id: string;
  first_name: string;
  last_name: string;
}

// --- Clients ---
// GET /publicapi/v1/clients?name={search}
export interface SingleCaseClient {
  id: string;
  name: string;
  // Not in the API payload but derived locally from contacts.
  // See clients.primary_domain in the DB schema.
}

// --- Cases (client_cases) ---
// GET /publicapi/v1/client_cases/{client_id}?name={search}
export interface SingleCaseCustomField {
  name: string;
  value: string;
}

export interface SingleCaseContactRef {
  id: string; // bare ID — no name or email; must be joined from contact index
}

export interface SingleCaseCourtRef {
  id: string;
}

export interface SingleCaseCase {
  id: string;
  case_id_visible: string; // e.g. "2016-0001"
  name: string;
  case_no: string;
  court_case_no: string | null;
  client_id: string;
  parent_id: string | null; // parent case for hierarchical matters
  project_state_id: string;
  currency: string;
  language: 'ces' | 'eng';
  created: string; // ISO timestamp
  responsible_user: SingleCaseUser | null;
  custom_fields: SingleCaseCustomField[];
  contacts: SingleCaseContactRef[];
  adversaries: SingleCaseContactRef[];
  courts: SingleCaseCourtRef[];
  courts_global: SingleCaseCourtRef[];
}

// --- Contacts ---
// GET /publicapi/v1/contacts?email={email} or ?name={search}
// Contacts are a separate index — case payloads contain only bare IDs.
export interface SingleCaseContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

// --- Activity Types ---
// GET /publicapi/v1/activity_types
export interface SingleCaseActivityType {
  id: string;
  name: string;
}

// --- Time Entries (already recorded) ---
// GET /publicapi/v1/time_entries?date={date}&user_id={user_id}
export interface SingleCaseTimeEntry {
  id: string;
  case_id: string;
  case_name: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  duration_minutes: number;
  description: string;
  activity_type: string;
  user_id: string;
}

// --- Activity (documents, notes, emails filed, tasks) ---
// GET /publicapi/v1/activity?date={date}&user_id={user_id}
export interface SingleCaseActivity {
  id: string;
  case_id: string;
  case_name: string;
  timestamp: string; // ISO local
  kind: 'document' | 'note' | 'email_filed' | 'task';
  summary: string;
  duration_minutes?: number;
  end_timestamp?: string;
  // For documents: file name
  file_name?: string;
  // For notes: note title
  note_title?: string;
  // For emails filed via Outlook add-in: original subject, sender, recipient
  email_subject?: string;
  email_sender?: string;
  email_recipient?: string;
  email_thread_id?: string;
  // For tasks: task key and title
  task_key?: string;
  task_title?: string;
}

// --- Project States ---
// The API may not expose state names. We maintain a local map.
export interface SingleCaseProjectState {
  id: string;
  name: string; // local fallback name, may not come from API
  is_open: boolean;
}
