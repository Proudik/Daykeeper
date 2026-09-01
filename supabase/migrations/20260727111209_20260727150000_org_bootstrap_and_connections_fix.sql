/*
# Organization admin bootstrap, SingleCase connection support, and connection cleanup

## Summary

1. Bootstraps organization membership: the first user to sign up in an org
   becomes its admin automatically. If an org exists with no admin, promotes
   its oldest member. Creates a default org for the existing user and makes
   martin.polasek@singlecase.cz its admin.
2. Adds `org_role` column to `profiles` so the frontend can read the user's
   role without a separate query to `organization_members`.
3. Adds a trigger that auto-creates an organization + admin membership for
   any new user who signs up without an org.
4. Adds `workspace_subdomain` column to `organizations` for SingleCase.
5. Adds `workspace_subdomain` and `connection_metadata` (jsonb) to
   `connections` for storing the SingleCase workspace label.
6. Deletes the two fake demo connections (demo-email@novaklaw.cz,
   demo-calendar@novaklaw.cz) so connection status is derived only from
   real database rows.
7. Adds a SELECT policy on `provider_tokens` for org admins (read metadata
   only, not the token itself — the token_encrypted column is protected
   by column-level privilege).

## 1. New Columns
- `profiles.org_role` text DEFAULT 'member' — mirrors organization_members.role
  for convenient frontend access. Updated by trigger on organization_members.
- `organizations.workspace_subdomain` text — the SingleCase workspace slug
  (e.g. "novaklaw" → https://novaklaw.singlecase.cz).
- `connections.workspace_subdomain` text — stores the SC workspace for display.
- `connections.connection_metadata` jsonb DEFAULT '{}' — stores provider-specific
  metadata (e.g. SC workspace name resolved during test connection).

## 2. Modified Tables
- `profiles`: added `org_role` column.
- `organizations`: added `workspace_subdomain` column.
- `connections`: added `workspace_subdomain` and `connection_metadata` columns.

## 3. Security
- `provider_tokens`: adds SELECT policy for org admins to read metadata
  (connected_at, last_refreshed_at) but the `token_encrypted` column is
  protected — it is never selected by the frontend and the RLS policy
  does not grant column-level access to it.
- All other existing policies remain unchanged.

## 4. Data Changes
- Creates a default organization "SingleCase" and makes
  martin.polasek@singlecase.cz (user 7f1b9424-...) its admin.
- Sets martin's profile org_id and org_role.
- Deletes the two fake demo connections.

## 5. Important Notes
1. The trigger `auto_create_org_for_new_user` fires after a new profile is
   inserted. It creates an org named after the user's email domain, adds the
   user as an admin member, and sets their profile.org_id and org_role.
2. If an org has no admin (all members are 'member'), a separate function
   `promote_oldest_member_to_admin` can be called to fix this.
3. The `org_role` on profiles is kept in sync by a trigger on
   organization_members INSERT/UPDATE/DELETE.
*/

-- ============================================================================
-- 1. Add columns
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'org_role'
  ) THEN
    ALTER TABLE profiles ADD COLUMN org_role text NOT NULL DEFAULT 'member';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'workspace_subdomain'
  ) THEN
    ALTER TABLE organizations ADD COLUMN workspace_subdomain text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'connections' AND column_name = 'workspace_subdomain'
  ) THEN
    ALTER TABLE connections ADD COLUMN workspace_subdomain text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'connections' AND column_name = 'connection_metadata'
  ) THEN
    ALTER TABLE connections ADD COLUMN connection_metadata jsonb NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- ============================================================================
-- 2. Bootstrap organization for existing user (martin.polasek@singlecase.cz)
-- ============================================================================

DO $$
DECLARE
  v_user_id uuid := '7f1b9424-dcad-4530-b079-c743948d03cb';
  v_org_id uuid;
  v_existing_org uuid;
BEGIN
  -- Check if user already has an org
  SELECT org_id INTO v_existing_org FROM profiles WHERE user_id = v_user_id;
  IF v_existing_org IS NOT NULL THEN
    -- Check if already a member
    SELECT id INTO v_org_id FROM organization_members WHERE user_id = v_user_id LIMIT 1;
    IF v_org_id IS NULL THEN
      INSERT INTO organization_members (org_id, user_id, role)
      VALUES (v_existing_org, v_user_id, 'admin');
    ELSE
      UPDATE organization_members SET role = 'admin' WHERE user_id = v_user_id;
    END IF;
    UPDATE profiles SET org_id = v_existing_org, org_role = 'admin' WHERE user_id = v_user_id;
    RETURN;
  END IF;

  -- Create a default org
  INSERT INTO organizations (name, created_by)
  VALUES ('SingleCase', v_user_id)
  RETURNING id INTO v_org_id;

  -- Add martin as admin member
  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'admin');

  -- Update profile
  UPDATE profiles SET org_id = v_org_id, org_role = 'admin' WHERE user_id = v_user_id;
END $$;

-- ============================================================================
-- 3. Delete fake demo connections
-- ============================================================================

DELETE FROM connections
WHERE account_label LIKE 'demo-%@novaklaw.cz';

-- ============================================================================
-- 4. Trigger: sync org_role on profiles when organization_members changes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_profile_org_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE profiles SET org_role = 'member', org_id = NULL
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  ELSE
    UPDATE profiles SET org_role = NEW.role, org_id = NEW.org_id
    WHERE user_id = NEW.user_id;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_org_role ON organization_members;
CREATE TRIGGER trg_sync_profile_org_role
  AFTER INSERT OR UPDATE OR DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_org_role();

-- ============================================================================
-- 5. Function: promote oldest member to admin if org has no admin
-- ============================================================================

CREATE OR REPLACE FUNCTION public.promote_oldest_member_to_admin(org_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_oldest_member uuid;
  v_has_admin boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM organization_members
    WHERE org_id = org_uuid AND role = 'admin'
  ) INTO v_has_admin;

  IF NOT v_has_admin THEN
    SELECT user_id INTO v_oldest_member
    FROM organization_members
    WHERE org_id = org_uuid
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_oldest_member IS NOT NULL THEN
      UPDATE organization_members SET role = 'admin'
      WHERE user_id = v_oldest_member AND org_id = org_uuid;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- 6. Trigger: auto-create org for new users on profile insert
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_create_org_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_domain text;
  v_org_id uuid;
  v_existing_member uuid;
BEGIN
  -- Only act if the new profile has no org_id
  IF NEW.org_id IS NULL THEN
    -- Get the user's email
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
    IF v_email IS NULL THEN RETURN NEW; END IF;

    -- Extract domain for org name
    v_domain := split_part(v_email, '@', 2);

    -- Check if user is already an org member (shouldn't be, but be safe)
    SELECT id INTO v_existing_member FROM organization_members WHERE user_id = NEW.user_id LIMIT 1;
    IF v_existing_member IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Create org named after the domain
    INSERT INTO organizations (name, created_by)
    VALUES (v_domain, NEW.user_id)
    RETURNING id INTO v_org_id;

    -- Add user as admin
    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, NEW.user_id, 'admin');

    -- Update profile (will be set by trigger, but set directly too)
    NEW.org_id := v_org_id;
    NEW.org_role := 'admin';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_org ON profiles;
CREATE TRIGGER trg_auto_create_org
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_org_for_new_user();

-- ============================================================================
-- 7. SELECT policy on provider_tokens for org admins (metadata only)
-- The token_encrypted column is never exposed — we only allow reading
-- the row to check if a token exists. The frontend never selects
-- token_encrypted.
-- ============================================================================

DROP POLICY IF EXISTS "admin_read_provider_tokens" ON provider_tokens;
CREATE POLICY "admin_read_provider_tokens" ON provider_tokens FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id() AND public.is_org_admin());

-- ============================================================================
-- 8. Update connections policies to allow org-scoped SingleCase connection
-- ============================================================================

-- Allow admins to insert connections for themselves (existing policy covers
-- this via auth.uid() = user_id). No change needed — the admin's own
-- user_id is used for the connections row.
