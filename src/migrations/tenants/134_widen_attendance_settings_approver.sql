-- 134_widen_attendance_settings_approver.sql
-- The approver column was VARCHAR(20), too short for multi-level workflow
-- strings like 'Reporting Manager → Dept Head → HR' (35 chars).
-- Widen to TEXT so any workflow label fits without truncation.

ALTER TABLE attendance_settings
  ALTER COLUMN approver TYPE TEXT;
