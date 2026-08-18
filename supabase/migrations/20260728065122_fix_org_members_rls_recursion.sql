-- Fix infinite recursion in organization_members SELECT policy.
-- The old policy subqueried organization_members from within its own RLS,
-- causing infinite recursion. Replace with a call to user_org_id() which
-- is SECURITY DEFINER and bypasses RLS.

DROP POLICY IF EXISTS "members_read_org_members" ON organization_members;

CREATE POLICY "members_read_org_members" ON organization_members
  FOR SELECT TO authenticated
  USING (org_id = user_org_id());
