-- 105_attendance_settings_expansion.sql
-- Expand attendance_settings to back the full Settings → Attendance tab dynamically:
-- overtime (require reason), shift settings, regularisation rules, and general settings.
-- (overtime_custom_multiplier and shift_type_default already exist and are reused.)

ALTER TABLE attendance_settings
  -- Overtime
  ADD COLUMN IF NOT EXISTS overtime_require_reason            BOOLEAN DEFAULT true,
  -- Shift settings
  ADD COLUMN IF NOT EXISTS shift_allow_employee_view          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS shift_change_request_enabled       BOOLEAN DEFAULT false,
  -- Regularisation settings
  ADD COLUMN IF NOT EXISTS regularization_allow_self          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS regularization_max_per_month       INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS regularization_auto_approve_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS regularization_auto_approve_after_days INTEGER DEFAULT 3,
  -- General attendance settings
  ADD COLUMN IF NOT EXISTS work_week_days                     VARCHAR(60) DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  ADD COLUMN IF NOT EXISTS grace_period_minutes               INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS half_day_threshold_hours           NUMERIC(4,2) DEFAULT 4,
  ADD COLUMN IF NOT EXISTS biometric_sync_enabled             BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS wfh_marking_allowed                BOOLEAN DEFAULT true;
