-- 101_leave_department_approval.sql
-- Adds the Department Head approval stage to the leave workflow (single-record, column-based).
-- New status flow:
--   Pending Manager Approval -> Pending Dept Approval -> Pending HR Approval -> Approved
--   (Rejected by Manager / Rejected by Dept / Rejected by HR / Cancelled at any open stage).
-- The department actor is tracked in its own columns, symmetric with manager_/hr_approved_*.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS department_approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_approved_at TIMESTAMPTZ;

COMMENT ON COLUMN leave_requests.department_approved_by IS
  'Employee id of the Department Head who approved the department stage';

COMMENT ON COLUMN leave_requests.status IS
  'Draft, Pending Manager Approval, Pending Dept Approval, Pending HR Approval, Approved, Rejected by Manager, Rejected by Dept, Rejected by HR, Cancelled';
