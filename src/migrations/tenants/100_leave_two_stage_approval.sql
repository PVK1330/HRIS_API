-- 100_leave_two_stage_approval.sql
-- Two-stage leave approval: Manager approval, then HR final approval.
-- status flow: Pending -> Manager_Approved -> Approved (or Rejected / Cancelled at any open stage).
-- approved_by / approved_at remain the FINAL (HR) approval, for backward compatibility with
-- existing queries; the per-stage actors are tracked separately below.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS manager_approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hr_approved_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_approved_at      TIMESTAMPTZ;

-- status column comment now records the extended lifecycle.
COMMENT ON COLUMN leave_requests.status IS
  'Pending, Manager_Approved, Approved, Rejected, Cancelled';
