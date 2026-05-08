-- 012_create_attendance_settings_table.sql
-- Tenant-scoped attendance configuration

CREATE TABLE IF NOT EXISTS attendance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  work_start_time TIME DEFAULT '09:00',
  work_end_time TIME DEFAULT '18:00',
  break_duration_minutes INTEGER DEFAULT 30,
  total_required_hours NUMERIC(4,2) DEFAULT 8.5,
  auto_calculate_hours BOOLEAN DEFAULT true,

  min_hours_for_present NUMERIC(4,2) DEFAULT 6,
  ten_minute_buffer BOOLEAN DEFAULT false,
  late_mark_auto_calculation BOOLEAN DEFAULT false,
  grace_days_per_month INTEGER DEFAULT 2,
  early_departure_rule VARCHAR(30) DEFAULT 'Mark half day',

  who_can_submit_request VARCHAR(30) DEFAULT 'All employees',
  approver VARCHAR(20) DEFAULT 'HR',
  auto_rejection_after_days INTEGER DEFAULT 3,

  overtime_eligibility BOOLEAN DEFAULT false,
  overtime_calculation_rule VARCHAR(30) DEFAULT '1.5x hourly',
  overtime_approval_workflow VARCHAR(30) DEFAULT 'Manager → HR',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_attendance_settings_updated_at
  BEFORE UPDATE ON attendance_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO attendance_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM attendance_settings LIMIT 1);
