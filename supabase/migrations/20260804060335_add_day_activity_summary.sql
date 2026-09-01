CREATE TABLE IF NOT EXISTS day_activity_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  providers text[] NOT NULL DEFAULT '{}',
  item_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

ALTER TABLE day_activity_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_day_summary" ON day_activity_summary FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_day_summary" ON day_activity_summary FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_day_summary" ON day_activity_summary FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_day_summary" ON day_activity_summary FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
