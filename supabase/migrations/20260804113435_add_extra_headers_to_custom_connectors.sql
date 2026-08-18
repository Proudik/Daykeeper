ALTER TABLE custom_connectors
  ADD COLUMN IF NOT EXISTS extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb;
