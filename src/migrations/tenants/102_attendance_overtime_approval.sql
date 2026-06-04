-- 102_attendance_overtime_approval.sql
-- Overtime approval workflow: when an employee records overtime, it requires the
-- reporting manager's approval; once approved it is forwarded to the department.
-- overtime_status: None (no OT) -> Pending (awaiting manager) -> Approved / Rejected.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS overtime_status            VARCHAR(20) NOT NULL DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS overtime_approved_by       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overtime_approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overtime_rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS overtime_forwarded_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_attendance_overtime_status
  ON attendance (overtime_status) WHERE overtime_status = 'Pending';
