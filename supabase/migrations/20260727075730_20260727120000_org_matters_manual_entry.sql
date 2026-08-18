/*
# Multi-user organization model, SingleCase matters/clients, and manual entry

## Summary

Transforms the app from independent personal accounts into a multi-user
firm model. Introduces organizations, organization_members, and
organization_invites. The SingleCase API token is held once per firm
(in provider_tokens, server-side only — never readable from the client).

Adds matters, clients, contacts, matter_contacts, matter_rules, and
activity_types as org-scoped reference data synced from SingleCase.
Every timesheet entry now belongs to exactly one matter (spis).

Adds manual entry support: entries with attribution_source='manual'
and matter_confidence='confirmed'.

## 1. New Tables

### Organization model
- `organizations` — id, name, singlecase_base_url, created_by, created_at.
- `organization_members` — id, org_id, user_id, role (admin/member),
  singlecase_user_id (nullable), joined_at. A user belongs to exactly one org.
- `organization_invites` — id, org_id, email, token, role, created_by,
  created_at, accepted_at, expires_at.

### SingleCase reference data (org-scoped)
- `clients` — id, org_id, external_id, name, primary_domain, synced_at.
- `matters` — id, org_id, external_id, case_id_visible, name, client_external_id,
  parent_external_id, project_state_id, state_is_open, responsible_user_id,
  responsible_user_name, language, currency, case_no, court_case_no,
  custom_fields (jsonb), is_internal, last_activity_at, synced_at.
- `contacts` — id, org_id, external_id, display_name, emails (text[]), synced_at.
- `matter_contacts` — id, org_id, matter_id, contact_external_id, role.
- `activity_types` — id, org_id, external_id, label, sort_order.

### Personal data (user-scoped)
- `matter_rules` — id, user_id, matter_id, rule_type, value, created_at,
  hit_count, source.
- `manual_entries` — id, user_id, work_date, start_time, duration_minutes,
  description, activity_type, matter_id, created_at.

### Server-side only
- `provider_tokens` — id, org_id, provider, token_encrypted, scopes,
  connected_at, last_refreshed_at. NO SELECT policy.

### Derived lookup
- `email_matter_lookup` — id, org_id, email_address, email_domain,
  matter_id, contact_external_id.

## 2. Modified Tables
- profiles: added org_id.
- timesheet_entries: added matter_id, matter_confidence, matter_reason,
  attribution_source, manual_entry_id.

## 3. Security — RLS
- Org-scoped reference data: members SELECT, admins write.
- User-scoped personal data: owner-only CRUD.
- provider_tokens: NO SELECT policy. Nobody can read from client.
- organization_members: members SELECT same-org, admins write.
- organization_invites: admins only.

## 4. Notes
1. activity_type_options deprecated; use activity_types.
2. connections remains user-scoped for per-user OAuth.
3. email_matter_lookup is the only table attribution queries during sessions.
4. Manual entries participate in overlap detection as high-priority sessions.
*/

-- ============================================================================
-- ORGANIZATION MODEL
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  singlecase_base_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  singlecase_user_id text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Add org_id to profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- SINGLECASE REFERENCE DATA (org-scoped)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  primary_domain text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id)
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  case_id_visible text,
  name text NOT NULL,
  client_external_id text,
  parent_external_id text,
  project_state_id text,
  state_is_open boolean NOT NULL DEFAULT true,
  responsible_user_id text,
  responsible_user_name text,
  language text NOT NULL DEFAULT 'other' CHECK (language IN ('ces', 'eng', 'other')),
  currency text,
  case_no text,
  court_case_no text,
  custom_fields jsonb NOT NULL DEFAULT '{}',
  is_internal boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id)
);
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  display_name text NOT NULL,
  emails text[] NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id)
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS matter_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  contact_external_id text NOT NULL,
  role text NOT NULL DEFAULT 'contact' CHECK (role IN ('contact', 'adversary')),
  UNIQUE (org_id, matter_id, contact_external_id)
);
ALTER TABLE matter_contacts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (org_id, external_id)
);
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- DERIVED LOOKUP FOR ATTRIBUTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_matter_lookup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  email_domain text NOT NULL,
  matter_id uuid NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  contact_external_id text,
  UNIQUE (org_id, email_address, matter_id)
);
ALTER TABLE email_matter_lookup ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_email_lookup_address ON email_matter_lookup(org_id, email_address);
CREATE INDEX IF NOT EXISTS idx_email_lookup_domain ON email_matter_lookup(org_id, email_domain);

-- ============================================================================
-- PERSONAL DATA (user-scoped)
-- ============================================================================

CREATE TABLE IF NOT EXISTS matter_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  matter_id uuid REFERENCES matters(id) ON DELETE SET NULL,
  rule_type text NOT NULL CHECK (rule_type IN (
    'email_address', 'email_domain', 'chat_channel', 'file_path_prefix',
    'task_project', 'calendar_series', 'keyword'
  )),
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'user_confirmed' CHECK (source IN ('user_confirmed', 'imported'))
);
ALTER TABLE matter_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  start_time text,
  duration_minutes integer NOT NULL,
  description text NOT NULL,
  activity_type text,
  matter_id uuid REFERENCES matters(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE manual_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SERVER-SIDE ONLY — NO CLIENT ACCESS
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  token_encrypted text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  UNIQUE (org_id, provider)
);
ALTER TABLE provider_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- MODIFY EXISTING TABLES
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheet_entries' AND column_name = 'matter_id') THEN
    ALTER TABLE timesheet_entries ADD COLUMN matter_id uuid REFERENCES matters(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheet_entries' AND column_name = 'matter_confidence') THEN
    ALTER TABLE timesheet_entries ADD COLUMN matter_confidence text NOT NULL DEFAULT 'unassigned'
      CHECK (matter_confidence IN ('confirmed', 'high', 'medium', 'low', 'unassigned'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheet_entries' AND column_name = 'matter_reason') THEN
    ALTER TABLE timesheet_entries ADD COLUMN matter_reason text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheet_entries' AND column_name = 'attribution_source') THEN
    ALTER TABLE timesheet_entries ADD COLUMN attribution_source text NOT NULL DEFAULT 'estimator'
      CHECK (attribution_source IN ('estimator', 'manual', 'manual_override'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'timesheet_entries' AND column_name = 'manual_entry_id') THEN
    ALTER TABLE timesheet_entries ADD COLUMN manual_entry_id uuid REFERENCES manual_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- RLS HELPER FUNCTIONS (public schema — cannot write to auth schema)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM public.organization_members WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- --- organizations ---
DROP POLICY IF EXISTS "members_read_organizations" ON organizations;
CREATE POLICY "members_read_organizations" ON organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.org_id = organizations.id
      AND organization_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_update_organizations" ON organizations;
CREATE POLICY "admin_update_organizations" ON organizations FOR UPDATE
  TO authenticated
  USING (public.is_org_admin())
  WITH CHECK (public.is_org_admin());

-- --- organization_members ---
DROP POLICY IF EXISTS "members_read_org_members" ON organization_members;
CREATE POLICY "members_read_org_members" ON organization_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members m2
      WHERE m2.org_id = organization_members.org_id
      AND m2.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_insert_org_members" ON organization_members;
CREATE POLICY "admin_insert_org_members" ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_org_members" ON organization_members;
CREATE POLICY "admin_update_org_members" ON organization_members FOR UPDATE
  TO authenticated
  USING (public.is_org_admin())
  WITH CHECK (public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_org_members" ON organization_members;
CREATE POLICY "admin_delete_org_members" ON organization_members FOR DELETE
  TO authenticated
  USING (public.is_org_admin());

-- --- organization_invites ---
DROP POLICY IF EXISTS "admin_read_invites" ON organization_invites;
CREATE POLICY "admin_read_invites" ON organization_invites FOR SELECT
  TO authenticated
  USING (public.is_org_admin());

DROP POLICY IF EXISTS "admin_insert_invites" ON organization_invites;
CREATE POLICY "admin_insert_invites" ON organization_invites FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_invites" ON organization_invites;
CREATE POLICY "admin_update_invites" ON organization_invites FOR UPDATE
  TO authenticated
  USING (public.is_org_admin())
  WITH CHECK (public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_invites" ON organization_invites;
CREATE POLICY "admin_delete_invites" ON organization_invites FOR DELETE
  TO authenticated
  USING (public.is_org_admin());

-- --- clients ---
DROP POLICY IF EXISTS "members_read_clients" ON clients;
CREATE POLICY "members_read_clients" ON clients FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_clients" ON clients;
CREATE POLICY "admin_write_clients" ON clients FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_clients" ON clients;
CREATE POLICY "admin_update_clients" ON clients FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_clients" ON clients;
CREATE POLICY "admin_delete_clients" ON clients FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- matters ---
DROP POLICY IF EXISTS "members_read_matters" ON matters;
CREATE POLICY "members_read_matters" ON matters FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_matters" ON matters;
CREATE POLICY "admin_write_matters" ON matters FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_matters" ON matters;
CREATE POLICY "admin_update_matters" ON matters FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_matters" ON matters;
CREATE POLICY "admin_delete_matters" ON matters FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- contacts ---
DROP POLICY IF EXISTS "members_read_contacts" ON contacts;
CREATE POLICY "members_read_contacts" ON contacts FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_contacts" ON contacts;
CREATE POLICY "admin_write_contacts" ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_contacts" ON contacts;
CREATE POLICY "admin_update_contacts" ON contacts FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_contacts" ON contacts;
CREATE POLICY "admin_delete_contacts" ON contacts FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- matter_contacts ---
DROP POLICY IF EXISTS "members_read_matter_contacts" ON matter_contacts;
CREATE POLICY "members_read_matter_contacts" ON matter_contacts FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_matter_contacts" ON matter_contacts;
CREATE POLICY "admin_write_matter_contacts" ON matter_contacts FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_matter_contacts" ON matter_contacts;
CREATE POLICY "admin_update_matter_contacts" ON matter_contacts FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_matter_contacts" ON matter_contacts;
CREATE POLICY "admin_delete_matter_contacts" ON matter_contacts FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- activity_types ---
DROP POLICY IF EXISTS "members_read_activity_types" ON activity_types;
CREATE POLICY "members_read_activity_types" ON activity_types FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_activity_types" ON activity_types;
CREATE POLICY "admin_write_activity_types" ON activity_types FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_activity_types" ON activity_types;
CREATE POLICY "admin_update_activity_types" ON activity_types FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_activity_types" ON activity_types;
CREATE POLICY "admin_delete_activity_types" ON activity_types FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- email_matter_lookup ---
DROP POLICY IF EXISTS "members_read_email_lookup" ON email_matter_lookup;
CREATE POLICY "members_read_email_lookup" ON email_matter_lookup FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS "admin_write_email_lookup" ON email_matter_lookup;
CREATE POLICY "admin_write_email_lookup" ON email_matter_lookup FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_email_lookup" ON email_matter_lookup;
CREATE POLICY "admin_delete_email_lookup" ON email_matter_lookup FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- --- matter_rules (user-scoped) ---
DROP POLICY IF EXISTS "select_own_matter_rules" ON matter_rules;
CREATE POLICY "select_own_matter_rules" ON matter_rules FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_matter_rules" ON matter_rules;
CREATE POLICY "insert_own_matter_rules" ON matter_rules FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_matter_rules" ON matter_rules;
CREATE POLICY "update_own_matter_rules" ON matter_rules FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_matter_rules" ON matter_rules;
CREATE POLICY "delete_own_matter_rules" ON matter_rules FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- --- manual_entries (user-scoped) ---
DROP POLICY IF EXISTS "select_own_manual_entries" ON manual_entries;
CREATE POLICY "select_own_manual_entries" ON manual_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_manual_entries" ON manual_entries;
CREATE POLICY "insert_own_manual_entries" ON manual_entries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_manual_entries" ON manual_entries;
CREATE POLICY "update_own_manual_entries" ON manual_entries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_manual_entries" ON manual_entries;
CREATE POLICY "delete_own_manual_entries" ON manual_entries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- --- provider_tokens (NO SELECT policy — server-side only) ---
DROP POLICY IF EXISTS "admin_write_provider_tokens" ON provider_tokens;
CREATE POLICY "admin_write_provider_tokens" ON provider_tokens FOR INSERT
  TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_update_provider_tokens" ON provider_tokens;
CREATE POLICY "admin_update_provider_tokens" ON provider_tokens FOR UPDATE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS "admin_delete_provider_tokens" ON provider_tokens;
CREATE POLICY "admin_delete_provider_tokens" ON provider_tokens FOR DELETE
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_matters_org ON matters(org_id);
CREATE INDEX IF NOT EXISTS idx_matters_org_open ON matters(org_id, state_is_open);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_matter_contacts_matter ON matter_contacts(matter_id);
CREATE INDEX IF NOT EXISTS idx_activity_types_org ON activity_types(org_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_matter_rules_user ON matter_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_entries_user_date ON manual_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_provider_tokens_org ON provider_tokens(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org ON profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_matter ON timesheet_entries(matter_id);
