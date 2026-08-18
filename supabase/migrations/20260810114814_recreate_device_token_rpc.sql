/*
# Recreate daykeeper_issue_device_token RPC

The function was created but PostgREST returned 404 on the REST endpoint.
Dropping and recreating the function to force PostgREST schema cache refresh.
Also ensuring the function is properly exposed to the API (PostgREST requires
functions to be in the public schema with execute granted to the appropriate roles).
*/

DROP FUNCTION IF EXISTS public.daykeeper_issue_device_token(text);

CREATE FUNCTION public.daykeeper_issue_device_token(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  INSERT INTO daykeeper_devices (user_id, label, token_hash)
  VALUES (v_user, p_label, v_hash);

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.daykeeper_issue_device_token(text) TO authenticated;
