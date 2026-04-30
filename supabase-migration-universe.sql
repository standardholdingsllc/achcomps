-- Universe-wide ACH tracking tables
-- Run this against your Supabase database (SQL Editor)

CREATE TABLE IF NOT EXISTS universe_weekly_ach (
  id serial PRIMARY KEY,
  week_number int NOT NULL,
  year int NOT NULL,
  ach_count int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_number, year)
);

CREATE TABLE IF NOT EXISTS universe_summary (
  id text PRIMARY KEY DEFAULT 'latest',
  prev_year_total int NOT NULL DEFAULT 0,
  prev_year_same_period int NOT NULL DEFAULT 0,
  curr_year_total int NOT NULL DEFAULT 0,
  yoy_change_percent float NOT NULL DEFAULT 0,
  trend text NOT NULL DEFAULT 'Stable',
  total_workers int NOT NULL DEFAULT 0,
  total_employers int NOT NULL DEFAULT 0,
  previous_year int NOT NULL DEFAULT 2025,
  current_year int NOT NULL DEFAULT 2026,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- If you already created the tables without the year columns, run:
-- ALTER TABLE universe_summary ADD COLUMN IF NOT EXISTS previous_year int NOT NULL DEFAULT 2025;
-- ALTER TABLE universe_summary ADD COLUMN IF NOT EXISTS current_year int NOT NULL DEFAULT 2026;
