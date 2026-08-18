-- 1. Stop auto-creating an org for every new user.
--    The profile is still created (by trg_auto_create_profile on auth.users),
--    but with org_id = NULL and org_role = 'member' (the column defaults).
--    The user chooses their role during onboarding.

CREATE OR REPLACE FUNCTION public.auto_create_org_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- No auto-org creation. Role is chosen in onboarding.
  RETURN NEW;
END;
$$;

-- 2. setup_as_admin() — called from onboarding when the user chooses "admin".
--    Creates an org named after the user's email domain, adds the user as
--    admin, and updates their profile. SECURITY DEFINER bypasses RLS so
--    the client can trigger org creation without direct table privileges.

CREATE OR REPLACE FUNCTION public.setup_as_admin()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_domain text;
  v_org_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Already in an org?
  SELECT org_id INTO v_org_id FROM organization_members WHERE user_id = v_user_id LIMIT 1;
  IF v_org_id IS NOT NULL THEN
    UPDATE organization_members SET role = 'admin' WHERE user_id = v_user_id;
    UPDATE profiles SET org_role = 'admin' WHERE user_id = v_user_id;
    RETURN v_org_id;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  v_domain := COALESCE(split_part(v_email, '@', 2), 'My Organization');

  INSERT INTO organizations (name, created_by)
  VALUES (v_domain, v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'admin');

  UPDATE profiles SET org_id = v_org_id, org_role = 'admin' WHERE user_id = v_user_id;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_as_admin() TO authenticated;
