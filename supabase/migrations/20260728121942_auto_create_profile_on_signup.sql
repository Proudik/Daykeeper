-- Auto-create a profiles row when a new auth user signs up.
-- This fires the existing auto_create_org_for_new_user trigger on profiles,
-- which creates an org and makes the user its admin.

CREATE OR REPLACE FUNCTION public.auto_create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_profile ON auth.users;
CREATE TRIGGER trg_auto_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_profile_for_new_user();
