-- Add source_item_ids array to timesheet_entries so we can detect
-- which activity items have already been used in a saved timesheet.
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS source_item_ids text[] NOT NULL DEFAULT '{}';

-- GIN index for fast "has this item been used?" lookups
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_source_item_ids
  ON timesheet_entries USING GIN (source_item_ids);
