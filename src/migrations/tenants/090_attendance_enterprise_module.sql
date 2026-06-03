-- 090_attendance_enterprise_module.sql
-- Enterprise attendance: shifts, holidays, audit, extended columns, workflow settings

-- ─── Attendance settings extensions ─────────────────────────────────────────
ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS approval_workflow_type VARCHAR(30) DEFAULT 'Two Level',
  ADD COLUMN IF NOT EXISTS weekend_mode VARCHAR(30) DEFAULT 'Saturday/Sunday',
  ADD COLUMN IF NOT EXISTS custom_week_off_days INTEGER[] DEFAULT ARRAY[0,6],
  ADD COLUMN IF NOT EXISTS uk_holiday_region VARCHAR(30) DEFAULT 'England',
  ADD COLUMN IF NOT EXISTS shift_type_default VARCHAR(30) DEFAULT 'General Shift';

-- ─── Attendance record extensions ─────────────────────────────────────────────
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS worked_hours DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS break_hours DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_day BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS leave_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS holiday_region VARCHAR(30),
  ADD COLUMN IF NOT EXISTS regularization_reason TEXT,
  ADD COLUMN IF NOT EXISTS regularization_remarks TEXT,
  ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_approval_level INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_attendance_regularization ON attendance (regularization_status)
  WHERE regularization_status = 'Pending';

-- ─── Shifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shift_type VARCHAR(30) NOT NULL DEFAULT 'General Shift',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 30,
  grace_minutes INTEGER NOT NULL DEFAULT 10,
  minimum_hours NUMERIC(4,2) DEFAULT 6,
  overtime_after_hours NUMERIC(4,2) DEFAULT 8,
  is_night_shift BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_shift_assignments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_rotational BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_employee_shift_employee ON employee_shift_assignments (employee_id);

-- ─── UK Holiday calendars ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  region VARCHAR(30) NOT NULL,
  year INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (region, year)
);

CREATE TABLE IF NOT EXISTS holiday_dates (
  id SERIAL PRIMARY KEY,
  calendar_id INTEGER NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name VARCHAR(255) NOT NULL,
  UNIQUE (calendar_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_holiday_dates_date ON holiday_dates (holiday_date);

-- ─── Regularization approval steps ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_regularization_steps (
  id SERIAL PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  approver_role VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  acted_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  acted_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attendance_id, level)
);

-- ─── Attendance audit log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_audit_logs (
  id SERIAL PRIMARY KEY,
  attendance_id INTEGER REFERENCES attendance(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  performed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(45),
  device_info TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_attendance ON attendance_audit_logs (attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_employee ON attendance_audit_logs (employee_id);

-- Default general shift
INSERT INTO shifts (name, shift_type, start_time, end_time, break_minutes, grace_minutes)
SELECT 'General Shift', 'General Shift', '09:00', '18:00', 30, 10
WHERE NOT EXISTS (SELECT 1 FROM shifts LIMIT 1);
