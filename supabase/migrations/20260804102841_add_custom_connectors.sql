/*
# Add custom connectors table

1. New Tables
- `custom_connectors` — org-scoped connector definitions created by admins.
  Stores everything needed to call an arbitrary REST API and map its response
  into ActivityItem[] for the timesheet estimator.
  Columns:
    - id (uuid PK)
    - org_id (FK → organizations, cascade delete)
    - name (text) — user-given label, e.g. "Slack", "Jira"
    - icon_key (text) — lucide-react icon name for display
    - auth_type (text, CHECK in 'api_key'|'bearer'|'basic'|'none')
    - base_url (text) — e.g. https://api.slack.com
    - api_key_encrypted (text) — the secret; never selected from client
    - endpoint_path (text) — path appended to base_url, e.g. /api/v1/activity
    - http_method (text, default 'GET', CHECK in 'GET'|'POST')
    - date_param_name (text, default 'since') — query param for start date
    - date_param_format (text, default 'iso') — 'iso'|'unix'|'YYYY-MM-DD'
    - end_date_param_name (text, nullable) — optional end date param
    - response_items_path (text, nullable) — dot-path to array in JSON response
    - field_mapping (jsonb) — maps response fields to ActivityItem fields
    - status (text, default 'active')
    - created_by (FK → auth.users)
    - created_at, updated_at (timestamptz)
2. Security
  - RLS enabled on custom_connectors.
  - SELECT: org members can see connector config (but NOT api_key_encrypted —
    column-level REVOKE prevents reading the secret).
  - INSERT/UPDATE/DELETE: org admins only (is_org_admin()).
  - api_key_encrypted column: REVOKE SELECT from authenticated and anon roles
    so the secret is never exposed to the browser. Only the service role
    (edge functions) can read it.
3. Important Notes
  - The edge function (custom-fetch) uses the service role key which bypasses
    RLS, so it can read api_key_encrypted to make authenticated API calls.
  - The client only ever selects non-secret columns.
*/

CREATE TABLE IF NOT EXISTS custom_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon_key text NOT NULL DEFAULT 'webhook',
  auth_type text NOT NULL CHECK (auth_type IN ('api_key', 'bearer', 'basic', 'none')),
  base_url text NOT NULL,
  api_key_encrypted text,
  endpoint_path text NOT NULL,
  http_method text NOT NULL DEFAULT 'GET' CHECK (http_method IN ('GET', 'POST')),
  date_param_name text DEFAULT 'since',
  date_param_format text DEFAULT 'iso',
  end_date_param_name text,
  response_items_path text,
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_connectors_org ON custom_connectors(org_id);

ALTER TABLE custom_connectors ENABLE ROW LEVEL SECURITY;

-- Members can see connector config (non-secret columns only)
DROP POLICY IF EXISTS "select_org_custom_connectors" ON custom_connectors;
CREATE POLICY "select_org_custom_connectors"
  ON custom_connectors FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());

-- Only admins can create connectors
DROP POLICY IF EXISTS "insert_admin_custom_connectors" ON custom_connectors;
CREATE POLICY "insert_admin_custom_connectors"
  ON custom_connectors FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_admin());

-- Only admins can update connectors
DROP POLICY IF EXISTS "update_admin_custom_connectors" ON custom_connectors;
CREATE POLICY "update_admin_custom_connectors"
  ON custom_connectors FOR UPDATE
  TO authenticated
  USING (public.is_org_admin())
  WITH CHECK (public.is_org_admin());

-- Only admins can delete connectors
DROP POLICY IF EXISTS "delete_admin_custom_connectors" ON custom_connectors;
CREATE POLICY "delete_admin_custom_connectors"
  ON custom_connectors FOR DELETE
  TO authenticated
  USING (public.is_org_admin());

-- Revoke SELECT on the secret column from all client-accessible roles
REVOKE SELECT (api_key_encrypted) ON custom_connectors FROM authenticated;
REVOKE SELECT (api_key_encrypted) ON custom_connectors FROM anon;
