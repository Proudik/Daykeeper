/*
# Force PostgREST schema cache refresh for daykeeper_issue_device_token

PostgREST was returning 404 for the RPC endpoint. Dropping and recreating
the function with a comment to force schema cache refresh.
*/

COMMENT ON FUNCTION public.daykeeper_issue_device_token(text) IS 'Issues a one-time pairing token for a browser extension device. Returns the plaintext token; only the SHA-256 hash is stored.';
