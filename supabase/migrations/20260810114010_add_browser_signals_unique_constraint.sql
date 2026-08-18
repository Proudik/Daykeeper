/*
# Add unique constraint for browser_signals upsert

The signals edge function uses upsert with onConflict: "user_id,day,bucket_start,domain".
This requires a unique constraint on those four columns so PostgreSQL can detect
conflicts when the extension re-sends a rollup for the same bucket+domain.

## Changes
- Add UNIQUE constraint "browser_signals_user_day_bucket_domain_key"
  on browser_signals (user_id, day, bucket_start, domain)
*/

CREATE UNIQUE INDEX IF NOT EXISTS browser_signals_user_day_bucket_domain_key
  ON browser_signals (user_id, day, bucket_start, domain);
