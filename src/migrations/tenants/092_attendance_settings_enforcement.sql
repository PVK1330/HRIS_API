-- 092_attendance_settings_enforcement.sql
-- Custom overtime multiplier for "Custom" calculation rule

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS overtime_custom_multiplier NUMERIC(5,2) DEFAULT 1.00;

COMMENT ON COLUMN attendance_settings.overtime_custom_multiplier IS
  'Multiplier when overtime_calculation_rule is Custom (e.g. 1.25)';
