-- 103_attendance_overtime_settings.sql
-- Overtime configuration on attendance_settings:
--   overtime_minimum_threshold_hours: overtime is only valid at/above this many hours.
--   overtime_approver: who approves overtime requests (defaults to HR).

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS overtime_minimum_threshold_hours NUMERIC(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_approver                VARCHAR(20) DEFAULT 'HR';
