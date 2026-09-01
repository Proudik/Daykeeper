/*
# Add browser signals and paired devices tables

## Purpose
Support the Daykeeper Signals browser extension: store paired browser devices
and the 15-minute browsing rollups they send. The extension authenticates with
a per-device token; the frontend (authenticated user) manages devices and reads
signals for timesheet estimation.

## New Tables

### daykeeper_devices
- `id` (uuid, PK, default gen_random_uuid)
- `user_id` (uuid, NOT NULL, default auth.uid(), FK to auth.users ON DELETE CASCADE)
- `label` (text, nullable — human-readable device name)
- `token_hash` (text, NOT NULL — SHA-256 hash of the pairing token; plaintext never stored)
- `created_at` (timestamptz, default now())
- `last_seen_at` (timestamptz, nullable — updated on each signal flush)
- `revoked_at` (timestamptz, nullable — set when device is revoked)

### browser_signals
- `id` (uuid, PK, default gen_random_uuid)
- `user_id` (uuid, NOT NULL, default auth.uid(), FK to auth.users ON DELETE CASCADE)
- `device_id` (uuid, nullable, FK to daykeeper_devices ON DELETE SET NULL)
- `day` (date, NOT NULL — local date in user's timezone)
- `bucket_start` (timestamptz, NOT NULL — start of the 15-min bucket)
- `domain` (text, NOT NULL — the domain visited)
- `duration_s` (integer, NOT NULL, default 0 — seconds of active time in this bucket)
- `session_count` (integer, NOT NULL, default 1)
- `edited` (boolean, default false)
- `fields_touched` (integer, default 0)
- `submits` (integer, default 0)
- `forms` (integer, default 0)
- `hints` (text, nullable)
- `updated_at` (timestamptz, default now())

### Indexes
- `browser_signals_user_day_idx` on browser_signals (user_id, day)
- `browser_signals_device_idx` on browser_signals (device_id)
- `daykeeper_devices_user_idx` on daykeeper_devices (user_id)

## RPC Function
### daykeeper_issue_device_token(p_label text)
- SECURITY DEFINER (runs as service role, bypasses RLS to insert the device row)
- Generates a random token, hashes it with SHA-256, stores the hash in
  daykeeper_devices, returns the plaintext token to the caller ONCE.
- Search path set to 'public' for safety.

## Security (RLS)

### daykeeper_devices
- SELECT: authenticated users can only see their own devices
- INSERT: handled by the SECURITY DEFINER RPC only (no direct INSERT policy)
- UPDATE: authenticated users can update their own devices (e.g. revoke)
- DELETE: authenticated users can delete their own devices

### browser_signals
- SELECT: authenticated users can only see their own signals
- INSERT: authenticated users can insert their own signals
- UPDATE: authenticated users can update their own signals
- DELETE: authenticated users can delete their own signals

## Notes
1. The pairing token plaintext is returned by the RPC exactly once and never
   stored. Only the SHA-256 hash is persisted in daykeeper_devices.token_hash.
2. The extension sends signals to a separate edge function (signals) that
   validates the token against the hash before inserting rows.
3. user_id columns default to auth.uid() so inserts from the frontend that
   omit user_id still satisfy WITH CHECK policies.
*/

-- === daykeeper_devices ===

CREATE TABLE IF NOT EXISTS daykeeper_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS daykeeper_devices_user_idx ON daykeeper_devices(user_id);

ALTER TABLE daykeeper_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_devices" ON daykeeper_devices;
CREATE POLICY "select_own_devices" ON daykeeper_devices FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_devices" ON daykeeper_devices;
CREATE POLICY "update_own_devices" ON daykeeper_devices FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_devices" ON daykeeper_devices;
CREATE POLICY "delete_own_devices" ON daykeeper_devices FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- === browser_signals ===

CREATE TABLE IF NOT EXISTS browser_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES daykeeper_devices(id) ON DELETE SET NULL,
  day date NOT NULL,
  bucket_start timestamptz NOT NULL,
  domain text NOT NULL,
  duration_s integer NOT NULL DEFAULT 0,
  session_count integer NOT NULL DEFAULT 1,
  edited boolean NOT NULL DEFAULT false,
  fields_touched integer NOT NULL DEFAULT 0,
  submits integer NOT NULL DEFAULT 0,
  forms integer NOT NULL DEFAULT 0,
  hints text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_signals_user_day_idx ON browser_signals(user_id, day);
CREATE INDEX IF NOT EXISTS browser_signals_device_idx ON browser_signals(device_id);

ALTER TABLE browser_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_signals" ON browser_signals;
CREATE POLICY "select_own_signals" ON browser_signals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_signals" ON browser_signals;
CREATE POLICY "insert_own_signals" ON browser_signals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_signals" ON browser_signals;
CREATE POLICY "update_own_signals" ON browser_signals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_signals" ON browser_signals;
CREATE POLICY "delete_own_signals" ON browser_signals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- === RPC: daykeeper_issue_device_token ===

CREATE OR REPLACE FUNCTION public.daykeeper_issue_device_token(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_token text;
  v_hash text;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Generate a random token (URL-safe, 32 chars)
  v_token := encode(gen_random_bytes(24), 'base64');
  v_token := replace(replace(v_token, '+', '-'), '/', '_');
  v_token := rtrim(v_token, '=');

  -- Hash it
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Store the hash, not the plaintext
  INSERT INTO daykeeper_devices (user_id, label, token_hash)
  VALUES (v_user, p_label, v_hash);

  RETURN v_token;
END;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.daykeeper_issue_device_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daykeeper_issue_device_token(text) TO authenticated;
