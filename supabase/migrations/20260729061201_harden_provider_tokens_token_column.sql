/*
# Harden provider_tokens: block token_encrypted column from client reads

## Problem
A previous migration added a SELECT policy on `provider_tokens` for org admins
so they can check connection status. The comment claimed the `token_encrypted`
column was protected by "column-level privilege" — but no REVOKE was ever
applied. Any org admin could read Google private keys, MS365 client secrets,
and SingleCase API tokens directly from the browser via the Supabase client.

## Fix
1. REVOKE column-level SELECT on `token_encrypted` from `authenticated` and
   `anon` roles. Admins can still SELECT the row (to see connected_at,
   last_refreshed_at, provider, scopes) but the token column itself is
   invisible to client-side queries.
2. GRANT SELECT on the remaining metadata columns explicitly so the policy
   still works for status checks.

## Security
- `token_encrypted` is now unreadable from any client role.
- Edge functions use the service role key, which bypasses RLS and column
  privileges, so they can still read the token server-side.
- No data is lost; no columns are dropped or renamed.
*/

-- Revoke all access to the token_encrypted column from client roles
REVOKE SELECT (token_encrypted) ON provider_tokens FROM authenticated;
REVOKE SELECT (token_encrypted) ON provider_tokens FROM anon;

-- Explicitly grant SELECT on metadata columns only (so the admin_read_provider_tokens
-- policy still returns rows, just without the token value)
GRANT SELECT (
  id, org_id, provider, scopes, connected_at, last_refreshed_at
) ON provider_tokens TO authenticated;
