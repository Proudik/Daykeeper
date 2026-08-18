-- Fix: pgcrypto's digest() lives in the "extensions" schema, but the RPC's
-- search_path was 'public' only, so digest() was not found at call time.
-- Schema-qualify the call so it works regardless of search_path.

CREATE OR REPLACE FUNCTION public.daykeeper_issue_webhook_token(p_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_token   text;
  v_hash    text;
  v_user_id uuid := auth.uid();
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Generate 24 random bytes, base64url-encoded
  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(v_token, '+', '-'), '/', '_');
  v_token := rtrim(v_token, '=');

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO webhook_endpoints (id, user_id, label, token_hash)
  VALUES (gen_random_uuid(), v_user_id, p_label, v_hash)
  RETURNING id INTO v_id;

  -- Return the plaintext token (with endpoint id as prefix for convenience)
  RETURN v_id::text || '|' || v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.daykeeper_issue_webhook_token FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daykeeper_issue_webhook_token TO authenticated;
