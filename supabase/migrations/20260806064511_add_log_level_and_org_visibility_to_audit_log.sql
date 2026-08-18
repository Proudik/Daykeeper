/*
# Add log level and org-scoped visibility to audit_log

## Purpose
Enables admins (like martin@managewise.co.uk) to see all log entries from
every member of their organization, including crashes and errors captured
by the frontend error handler.

## Changes to `audit_log` table
1. Add `level` column (text, default 'info') — categorizes log entries as
   'info', 'warning', or 'error'. This lets the admin logs page filter and
   highlight errors and crashes separately from normal activity logs.
2. Add `org_id` column (uuid, nullable) — stores the organization ID at
   the time the log was written, so admins can query logs from all members
   of their org without needing to join through profiles.

## RLS policy changes
- Replace the SELECT policy so that:
  a) Users can still see their own logs (unchanged behavior).
  b) Admins can additionally see logs from all members of their organization
     (via org_id matching their own org membership with role = 'admin').
- INSERT policy updated to allow setting org_id when the user is a member
  of that org (so the frontend error handler can write error-level logs).
- UPDATE and DELETE policies remain owner-scoped (unchanged).

## Security notes
1. The admin SELECT policy checks that the requesting user is an admin of
   the same organization via the `organization_members` table.
2. The org_id on INSERT is validated against organization_members to prevent
   users from writing logs under a different org.
3. Existing rows get org_id backfilled from the profiles table where possible.
*/

-- Add level column
DO $$ BEGIN
  ALTER TABLE audit_log ADD COLUMN level text NOT NULL DEFAULT 'info';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add org_id column
DO $$ BEGIN
  ALTER TABLE audit_log ADD COLUMN org_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Backfill org_id from profiles for existing rows
UPDATE audit_log a
SET org_id = p.org_id
FROM profiles p
WHERE a.user_id = p.user_id
  AND a.org_id IS NULL
  AND p.org_id IS NOT NULL;

-- Add index for admin queries (org_id + occurred_at)
CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON audit_log(org_id, occurred_at DESC);

-- Replace SELECT policy: users see own logs, admins see all org logs
DROP POLICY IF EXISTS "select_own_audit_log" ON audit_log;
CREATE POLICY "select_own_audit_log" ON audit_log FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      org_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = audit_log.org_id
          AND om.role = 'admin'
      )
    )
  );

-- Replace INSERT policy: allow setting org_id if user is member of that org
DROP POLICY IF EXISTS "insert_own_audit_log" ON audit_log;
CREATE POLICY "insert_own_audit_log" ON audit_log FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      org_id IS NULL
      OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.org_id = audit_log.org_id
      )
    )
  );

-- UPDATE and DELETE policies remain unchanged (owner-scoped)
DROP POLICY IF EXISTS "update_own_audit_log" ON audit_log;
CREATE POLICY "update_own_audit_log" ON audit_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_audit_log" ON audit_log;
CREATE POLICY "delete_own_audit_log" ON audit_log FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
