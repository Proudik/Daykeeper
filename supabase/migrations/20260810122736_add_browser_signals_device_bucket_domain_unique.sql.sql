/*
# Add unique constraint on (user_id, device_id, bucket_start, domain)

## Purpose
The signals edge function upserts rollups on the key (user_id, device_id,
bucket_start, domain) — the extension resends its entire recent window on
every send, so the same rollup arrives repeatedly with a growing duration_s.
Upserting on this key makes retries safe and idempotent.

## Changes
- Add UNIQUE index "browser_signals_user_device_bucket_domain_key"
  on browser_signals (user_id, device_id, bucket_start, domain)

## Notes
- The existing unique index on (user_id, day, bucket_start, domain) remains
  in place for backward compatibility with any code that still upserts on `day`.
- The new index covers the key the extension actually sends (device_id +
  bucket_start + domain), since the extension does not send a `day` field —
  it sends `date` which the edge function maps to the `day` column.
*/

CREATE UNIQUE INDEX IF NOT EXISTS browser_signals_user_device_bucket_domain_key
  ON browser_signals (user_id, device_id, bucket_start, domain);