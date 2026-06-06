-- 109_leave_dept_approval.sql
-- Add Department Head as an intermediate approval stage to the leave workflow.
-- Full hierarchy: Employee → Reporting Manager → Department Head → HR/Admin.
--
-- leave_requests.status flow (extended):
--   Draft
--   → Pending Manager Approval
--   → Pending Dept Approval      ← new intermediate stage
--   → Pending HR Approval
--   → Approved
--   → Rejected by Manager | Rejected by Dept | Rejected by HR
--   → Cancelled
--
-- If the employee has no reporting manager, applyLeave sets the initial status
-- to "Pending Dept Approval" directly (manager stage is skipped).

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS dept_approved_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dept_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dept_remarks      TEXT;

COMMENT ON COLUMN leave_requests.status IS
  'Draft, Pending Manager Approval, Pending Dept Approval, Pending HR Approval, Approved, Rejected by Manager, Rejected by Dept, Rejected by HR, Cancelled';
