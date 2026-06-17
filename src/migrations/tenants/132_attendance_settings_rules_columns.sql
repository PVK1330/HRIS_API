-- 132_attendance_settings_rules_columns.sql
-- Add dedicated columns for presentRules, halfDayRules, absentRules, lateMarkRules
-- as configured in the Attendance Settings UI.

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS present_status_code      VARCHAR(4)    DEFAULT 'P',
  ADD COLUMN IF NOT EXISTS half_day_min_hours        NUMERIC(4,2)  DEFAULT 4,
  ADD COLUMN IF NOT EXISTS half_day_max_hours        NUMERIC(4,2)  DEFAULT 7.98,
  ADD COLUMN IF NOT EXISTS half_day_status_code      VARCHAR(4)    DEFAULT 'HD',
  ADD COLUMN IF NOT EXISTS absent_below_hours        NUMERIC(4,2)  DEFAULT 4,
  ADD COLUMN IF NOT EXISTS absent_status_code        VARCHAR(4)    DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS auto_mark_absent          BOOLEAN       DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_late_mark          BOOLEAN       DEFAULT true,
  ADD COLUMN IF NOT EXISTS late_mark_status_code     VARCHAR(4)    DEFAULT 'L',
  ADD COLUMN IF NOT EXISTS penalty_3_lates_result    VARCHAR(50)   DEFAULT 'Half Day',
  ADD COLUMN IF NOT EXISTS penalty_6_lates_result    VARCHAR(50)   DEFAULT '1 Leave Deduction';
