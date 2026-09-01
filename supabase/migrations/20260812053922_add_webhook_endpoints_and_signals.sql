/*
# Add webhook endpoints and webhook signals

## Purpose
Lets each user create a personal API endpoint that external automation tools
(make.com, Zapier, n8n, custom scripts) can POST activity data to. The data is
stored and surfaced alongside browser signals and other providers in the day
view and timesheet generation.

## New Tables

### webhook_endpoints
- `id` (uuid, primary key)
- `user_id` (uuid, not null, references auth.users, cascade delete) — owner
- `label` (text, not null) — user-friendly name e.g. "Make.com scenario"
- `token_hash` (text, not null) — SHA-256 hash of the bearer token; plaintext never stored
- `last_used_at` (timestamptz) — updated on each successful POST
- `created_at` (timestamptz, default now)
- `revoked_at` (timestamptz) — set when user revokes the endpoint

### webhook_signals
- `id` (uuid, primary key)
- `user_id` (uuid, not null, references auth.users, cascade delete) — owner
- `endpoint_id` (uuid, references webhook_endpoints, cascade delete) — which endpoint received it
- `day` (date, not null) — local calendar date extracted from the activity timestamp
- `timestamp` (timestamptz, not null) — when the activity occurred
- `summary` (text, not null) — human-readable label
- `duration_minutes` (integer, default 0) — optional duration
- `end_timestamp` (timestamptz) — optional end time
- `source` (text) — free-form source label from the external tool
- `meta` (jsonb, default '{}') — arbitrary metadata (sender, subject, channel, etc.)
- `external_id` (text) — dedup key from the external tool
- `created_at` (timestamptz, default now)

## Security
- RLS enabled on both tables; owner-only CRUD via auth.uid() = user_id
- token_hash column on webhook_endpoints is REVOKE'd from authenticated and anon
  so no client can read the hash
- A SECURITY DEFINER RPC `daykeeper_issue_webhook_token(p_label text)` generates
  a random token, stores only its SHA-256 hash, and returns the plaintext once
- A SECURITY DEFINER RPC `daykeeper_revoke_webhook_endpoint(p_endpoint_id uuid)`
  sets revoked_at on an endpoint

## Important Notes
1. The plaintext webhook token is returned ONLY at creation time — it is never
   stored or retrievable again, just like device tokens.
2. webhook_signals uses a unique constraint on (user_id, endpoint_id, external_id)
   so external tools can safely retry without creating duplicates.
3. The edge function authenticates by hashing the incoming bearer token and
   matching against webhook_endpoints.token_hash, identical to the browser
   extension device-token pattern.
*/

-- ─── webhook_endpoints ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  label        text NOT NULL,
  token_hash   text NOT NULL,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_webhook_endpoints" ON webhook_endpoints;
CREATE POLICY "select_own_webhook_endpoints"
  ON webhook_endpoints FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_webhook_endpoints" ON webhook_endpoints;
CREATE POLICY "update_own_webhook_endpoints"
  ON webhook_endpoints FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_webhook_endpoints" ON webhook_endpoints;
CREATE POLICY "delete_own_webhook_endpoints"
  ON webhook_endpoints FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- No direct INSERT policy — insertion is done exclusively by the
-- daykeeper_issue_webhook_token SECURITY DEFINER RPC.

-- Protect the token hash from client reads
REVOKE SELECT (token_hash) ON webhook_endpoints FROM authenticated;
REVOKE SELECT (token_hash) ON webhook_endpoints FROM anon;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user ON webhook_endpoints(user_id);

-- ─── webhook_signals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint_id      uuid REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  day             date NOT NULL,
  timestamp       timestamptz NOT NULL,
  summary         text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0,
  end_timestamp   timestamptz,
  source          text,
  meta            jsonb NOT NULL DEFAULT '{}',
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_webhook_signals" ON webhook_signals;
CREATE POLICY "select_own_webhook_signals"
  ON webhook_signals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_webhook_signals" ON webhook_signals;
CREATE POLICY "insert_own_webhook_signals"
  ON webhook_signals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_webhook_signals" ON webhook_signals;
CREATE POLICY "update_own_webhook_signals"
  ON webhook_signals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_webhook_signals" ON webhook_signals;
CREATE POLICY "delete_own_webhook_signals"
  ON webhook_signals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_webhook_signals_user_day ON webhook_signals(user_id, day);

-- Unique dedup key: one (endpoint, external_id) per user
CREATE UNIQUE INDEX IF NOT EXISTS webhook_signals_user_endpoint_ext_id_key
  ON webhook_signals(user_id, endpoint_id, external_id)
  WHERE external_id IS NOT NULL;

-- ─── RPC: issue webhook token ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.daykeeper_issue_webhook_token(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_token   text;
  v_hash    text;
  v_user_id uuid := auth.uid();
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Generate 24 random bytes, base64url-encoded
  v_token := encode(gen_random_bytes(24), 'base64');
  v_token := replace(replace(v_token, '+', '-'), '/', '_');
  v_token := rtrim(v_token, '=');

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO webhook_endpoints (id, user_id, label, token_hash)
  VALUES (gen_random_uuid(), v_user_id, p_label, v_hash)
  RETURNING id INTO v_id;

  -- Return the plaintext token (with endpoint id as prefix for convenience)
  RETURN v_id::text || '|' || v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.daykeeper_issue_webhook_token FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daykeeper_issue_webhook_token TO authenticated;

-- ─── RPC: revoke webhook endpoint ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.daykeeper_revoke_webhook_endpoint(p_endpoint_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE webhook_endpoints
  SET revoked_at = now()
  WHERE id = p_endpoint_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.daykeeper_revoke_webhook_endpoint FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daykeeper_revoke_webhook_endpoint TO authenticated;
