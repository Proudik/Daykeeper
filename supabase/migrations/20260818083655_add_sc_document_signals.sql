/*
# Add SingleCase document-editing signals table

## Purpose
Simulates document-editing activity from SingleCase (e.g., editing a Word document).
Each row represents a document-editing session: how long the document was open/edited
and how many words were typed. This feeds the Daykeeper timeline just like browser
and webhook signals do.

## New Table: `sc_document_signals`
- `id` (uuid, primary key)
- `user_id` (uuid, not null, defaults to auth.uid()) — owner of the signal
- `day` (text, not null) — 'YYYY-MM-DD' local calendar day, for grouping
- `timestamp` (timestamptz, not null) — when the editing session started (ISO UTC)
- `end_timestamp` (timestamptz, null) — when the editing session ended
- `duration_minutes` (integer, not null, default 0) — total editing duration
- `file_name` (text, not null) — name of the document being edited
- `case_id` (text, null) — SingleCase matter/case external ID this document belongs to
- `case_name` (text, null) — display name of the case
- `case_id_visible` (text, null) — visible case identifier (e.g., "CASE-001")
- `word_count` (integer, not null, default 0) — number of words typed during the session
- `revision_count` (integer, not null, default 1) — number of revisions/saves
- `summary` (text, null) — human-readable summary
- `meta` (jsonb, null) — extra metadata bag
- `created_at` (timestamptz, default now())

## Security
- RLS enabled on `sc_document_signals`.
- Owner-scoped CRUD: each authenticated user can only access rows they own.
- `user_id` defaults to `auth.uid()` so inserts omitting it still succeed.

## Indexes
- `sc_document_signals_day_user_idx` on (user_id, day) for efficient day queries.
*/

CREATE TABLE IF NOT EXISTS sc_document_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  day text NOT NULL,
  timestamp timestamptz NOT NULL,
  end_timestamp timestamptz,
  duration_minutes integer NOT NULL DEFAULT 0,
  file_name text NOT NULL,
  case_id text,
  case_name text,
  case_id_visible text,
  word_count integer NOT NULL DEFAULT 0,
  revision_count integer NOT NULL DEFAULT 1,
  summary text,
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sc_document_signals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sc_document_signals_day_user_idx
  ON sc_document_signals (user_id, day);

DROP POLICY IF EXISTS "select_own_sc_document_signals" ON sc_document_signals;
CREATE POLICY "select_own_sc_document_signals"
  ON sc_document_signals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_sc_document_signals" ON sc_document_signals;
CREATE POLICY "insert_own_sc_document_signals"
  ON sc_document_signals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_sc_document_signals" ON sc_document_signals;
CREATE POLICY "update_own_sc_document_signals"
  ON sc_document_signals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_sc_document_signals" ON sc_document_signals;
CREATE POLICY "delete_own_sc_document_signals"
  ON sc_document_signals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
