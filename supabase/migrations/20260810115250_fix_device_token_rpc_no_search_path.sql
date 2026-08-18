/*
# Fix daykeeper_issue_device_token 404 — remove SET search_path

PostgREST was returning 404 for the RPC. The working function setup_as_admin
does NOT use SET search_path, while this one does. Removing it to match the
working pattern. Also schema-qualifying all table references inside the
function body as a safer alternative to SET search_path.
*/

DROP FUNCTION IF EXISTS public.daykeeper_issue_device_token(text);

CREATE FUNCTION public.daykeeper_issue_device_token(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token text;
  v_hash text;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_token := encode(gen_random_bytes(24), 'base64');
  v_token := replace(replace(v_token, '+', '-'), '/', '_');
  v_token := rtrim(v_token, '=');

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.daykeeper_devices (user_id, label, token_hash)
  VALUES (v_user, p_label, v_hash);

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.daykeeper_issue_device_token(text) TO authenticated;
