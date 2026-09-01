/*
# Daykeeper — initial schema

A daily timesheet generator for lawyers. Activity data from connected apps
(email, calendar, chat, tasks, documents) is fetched into memory, used to
generate draft timesheet entries, and discarded — it is NEVER persisted. Only
the lawyer's own final timesheet text and their account settings are stored.

## 1. New tables

- `profiles` — one row per user, created on first sign-in. Holds display name,
  timezone, working hours, billing preferences (rounding increment, target
  billable hours, output language).
  - `user_id` uuid PRIMARY KEY, references auth.users, ON DELETE CASCADE.
  - `display_name` text.
  - `timezone` text (IANA name, e.g. "Europe/Prague").
  - `working_hours_start` text (HH:mm, 24h).
  - `working_hours_end` text (HH:mm, 24h).
  - `rounding_minutes` integer (0 = exact, 6, 15). Default 15.
  - `target_hours` numeric(4,2). Default 8.00.
  - `output_language` text ('cs' or 'en'). Default 'en'.
  - `onboarded` boolean. Default false. Flipped to true after onboarding.
  - `demo_mode` boolean. Default false. True when user skipped app connections.
  - `created_at` timestamptz DEFAULT now().

- `connections` — one row per connected third-party app per user. No tokens are
  stored here (or anywhere); this table only records that a connection exists,
  the account label, granted scopes, and status/error metadata.
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `provider` text NOT NULL ('email' | 'calendar' | 'chat' | 'tasks' | 'documents').
  - `status` text NOT NULL DEFAULT 'not_connected'
    ('not_connected' | 'connected' | 'needs_reauth' | 'error').
  - `account_label` text (e.g. "jan.novak@novaklaw.cz").
  - `scopes_granted` text[] DEFAULT '{}'.
  - `connected_at` timestamptz.
  - `last_used_at` timestamptz.
  - `last_error` text.
  - UNIQUE (user_id, provider).

- `activity_type_options` — user-editable taxonomy of activity types used to
  label timesheet entries (e.g. "Legal research", "Client meeting").
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `label` text NOT NULL.
  - `sort_order` integer NOT NULL DEFAULT 0.

- `exclusion_rules` — rules that cause fetched activity to be automatically
  ignored (e.g. an email domain, a chat channel, a calendar keyword).
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `rule_type` text NOT NULL ('email_domain' | 'chat_channel' | 'calendar_keyword').
  - `value` text NOT NULL.

- `timesheets` — one per generated timesheet per work day.
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `work_date` date NOT NULL.
  - `status` text NOT NULL DEFAULT 'draft' ('draft' | 'final').
  - `model_used` text (which generation model/version produced it).
  - `generated_at` timestamptz DEFAULT now().
  - `source_providers` text[] DEFAULT '{}'.
  - `total_minutes` integer NOT NULL DEFAULT 0.
  - UNIQUE (user_id, work_date).

- `timesheet_entries` — the individual editable entries within a timesheet.
  These hold the lawyer's own final narrative text — the only user-authored
  content that is persisted.
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `timesheet_id` uuid NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE.
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `sort_order` integer NOT NULL DEFAULT 0.
  - `description` text NOT NULL.
  - `suggested_minutes` integer NOT NULL DEFAULT 0.
  - `confirmed_minutes` integer NOT NULL DEFAULT 0.
  - `activity_type` text.
  - `billable` boolean NOT NULL DEFAULT true.
  - `confidence` text NOT NULL DEFAULT 'medium' ('low' | 'medium' | 'high').
  - `source_summary` text (short human-readable list of what fed this entry —
    NOT raw activity content).

- `audit_log` — append-only record of significant actions (connect, disconnect,
  fetch, generate, export, delete). NEVER records activity content, only short
  metadata about the action.
  - `id` uuid PRIMARY KEY DEFAULT gen_random_uuid().
  - `user_id` uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE.
  - `action` text NOT NULL.
  - `provider` text.
  - `occurred_at` timestamptz DEFAULT now().
  - `detail` text.

## 2. Security — Row Level Security

RLS is enabled on EVERY table. All policies are owner-scoped: a user can only
ever read or write rows where `user_id = auth.uid()`. There are no public/shared
tables. Four separate policies (select/insert/update/delete) per table, scoped
`TO authenticated`.

`user_id` columns default to `auth.uid()` so inserts that omit the column
still satisfy the INSERT `WITH CHECK` policy.

## 3. Important notes

1. There is NO table that stores email bodies, chat message text, document
   contents, or attachments. Activity data is fetched, held in memory, used,
   and discarded. Only the lawyer's own final timesheet text is persisted.
2. No tokens are stored in `connections` or anywhere in the database.
3. `audit_log` records action metadata only — never activity content.
4. `timesheet_entries.source_summary` is a short human-readable string the
   lawyer writes/edits, not raw fetched content.
*/

-- profiles
CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  timezone text DEFAULT 'Europe/Prague',
  working_hours_start text DEFAULT '08:30',
  working_hours_end text DEFAULT '18:00',
  rounding_minutes integer NOT NULL DEFAULT 15,
  target_hours numeric(4,2) NOT NULL DEFAULT 8.00,
  output_language text NOT NULL DEFAULT 'en',
  onboarded boolean NOT NULL DEFAULT false,
  demo_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- connections
CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'not_connected',
  account_label text,
  scopes_granted text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  UNIQUE (user_id, provider)
);
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_connections" ON connections;
CREATE POLICY "select_own_connections" ON connections FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_connections" ON connections;
CREATE POLICY "insert_own_connections" ON connections FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_connections" ON connections;
CREATE POLICY "update_own_connections" ON connections FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_connections" ON connections;
CREATE POLICY "delete_own_connections" ON connections FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- activity_type_options
CREATE TABLE IF NOT EXISTS activity_type_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE activity_type_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_activity_types" ON activity_type_options;
CREATE POLICY "select_own_activity_types" ON activity_type_options FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_activity_types" ON activity_type_options;
CREATE POLICY "insert_own_activity_types" ON activity_type_options FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_activity_types" ON activity_type_options;
CREATE POLICY "update_own_activity_types" ON activity_type_options FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_activity_types" ON activity_type_options;
CREATE POLICY "delete_own_activity_types" ON activity_type_options FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- exclusion_rules
CREATE TABLE IF NOT EXISTS exclusion_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_type text NOT NULL,
  value text NOT NULL
);
ALTER TABLE exclusion_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exclusion_rules" ON exclusion_rules;
CREATE POLICY "select_own_exclusion_rules" ON exclusion_rules FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_exclusion_rules" ON exclusion_rules;
CREATE POLICY "insert_own_exclusion_rules" ON exclusion_rules FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_exclusion_rules" ON exclusion_rules;
CREATE POLICY "update_own_exclusion_rules" ON exclusion_rules FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_exclusion_rules" ON exclusion_rules;
CREATE POLICY "delete_own_exclusion_rules" ON exclusion_rules FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- timesheets
CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  model_used text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  source_providers text[] NOT NULL DEFAULT '{}',
  total_minutes integer NOT NULL DEFAULT 0,
  UNIQUE (user_id, work_date)
);
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_timesheets" ON timesheets;
CREATE POLICY "select_own_timesheets" ON timesheets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_timesheets" ON timesheets;
CREATE POLICY "insert_own_timesheets" ON timesheets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_timesheets" ON timesheets;
CREATE POLICY "update_own_timesheets" ON timesheets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_timesheets" ON timesheets;
CREATE POLICY "delete_own_timesheets" ON timesheets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- timesheet_entries
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  suggested_minutes integer NOT NULL DEFAULT 0,
  confirmed_minutes integer NOT NULL DEFAULT 0,
  activity_type text,
  billable boolean NOT NULL DEFAULT true,
  confidence text NOT NULL DEFAULT 'medium',
  source_summary text
);
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_timesheet_entries" ON timesheet_entries;
CREATE POLICY "select_own_timesheet_entries" ON timesheet_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_timesheet_entries" ON timesheet_entries;
CREATE POLICY "insert_own_timesheet_entries" ON timesheet_entries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_timesheet_entries" ON timesheet_entries;
CREATE POLICY "update_own_timesheet_entries" ON timesheet_entries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_timesheet_entries" ON timesheet_entries;
CREATE POLICY "delete_own_timesheet_entries" ON timesheet_entries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  provider text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_audit_log" ON audit_log;
CREATE POLICY "select_own_audit_log" ON audit_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_audit_log" ON audit_log;
CREATE POLICY "insert_own_audit_log" ON audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_audit_log" ON audit_log;
CREATE POLICY "update_own_audit_log" ON audit_log FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_audit_log" ON audit_log;
CREATE POLICY "delete_own_audit_log" ON audit_log FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_types_user ON activity_type_options(user_id);
CREATE INDEX IF NOT EXISTS idx_exclusion_rules_user ON exclusion_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_user_date ON timesheets(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_timesheet ON timesheet_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_user ON timesheet_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, occurred_at);