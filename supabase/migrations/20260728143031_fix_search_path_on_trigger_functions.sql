-- Fix: SECURITY DEFINER functions must have a fixed search_path.
-- Without it, Supabase rejects the trigger call during auth.users INSERT,
-- producing "Database error saving new user" on signup.

CREATE OR REPLACE FUNCTION public.auto_create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_create_org_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No auto-org creation. Role is chosen in onboarding.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.setup_as_admin()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
