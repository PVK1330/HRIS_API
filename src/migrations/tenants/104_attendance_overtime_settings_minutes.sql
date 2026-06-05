-- 104_attendance_overtime_settings_minutes.sql
-- Overtime settings refinements:
--   overtime_minimum_threshold_minutes: OT counts only after this many minutes past regular hours.
--   overtime_max_per_month_hours:       cap on OT hours per employee per calendar month (0 = unlimited).
-- Replaces the earlier hours-based threshold column.

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS overtime_minimum_threshold_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS overtime_max_per_month_hours       NUMERIC(6,2) DEFAULT 0,
  DROP COLUMN IF EXISTS overtime_minimum_threshold_hours;
