-- 093_attendance_cron_support.sql
-- Company closures + daily attendance summary snapshots for cron

CREATE TABLE IF NOT EXISTS company_closures (
  id SERIAL PRIMARY KEY,
  closure_date DATE NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Company Closure',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (closure_date)
);

CREATE INDEX IF NOT EXISTS idx_company_closures_date ON company_closures (closure_date)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS attendance_daily_summaries (
  id SERIAL PRIMARY KEY,
  summary_date DATE NOT NULL UNIQUE,
  present_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  on_leave_count INTEGER NOT NULL DEFAULT 0,
  holiday_count INTEGER NOT NULL DEFAULT 0,
  weekend_count INTEGER NOT NULL DEFAULT 0,
  remote_count INTEGER NOT NULL DEFAULT 0,
  in_office_count INTEGER NOT NULL DEFAULT 0,
  pending_regularization INTEGER NOT NULL DEFAULT 0,
  missing_checkout INTEGER NOT NULL DEFAULT 0,
  total_employees INTEGER NOT NULL DEFAULT 0,
  summary_payload JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_daily_summaries_date ON attendance_daily_summaries (summary_date);
