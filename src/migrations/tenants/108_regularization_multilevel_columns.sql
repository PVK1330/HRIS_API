-- 108_regularization_multilevel_columns.sql
-- Column-based three-stage regularization approval tracking.
-- Instead of a separate per-step rows table, each approver's decision is stored as
-- dedicated columns on the attendance row so the full trail is visible in one place.
--
-- regularization_status flow (extended):
--   N/A  → Pending → Manager_Approved → Dept_Approved → Approved
--                  ↘               ↘               ↘  → Rejected (any stage)
--
-- If the employee has no reporting manager the service advances directly to
-- Manager_Approved on submission, and the dept head becomes first approver.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS reg_manager_approved_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reg_manager_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reg_manager_remarks      TEXT,
  ADD COLUMN IF NOT EXISTS reg_dept_approved_by     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reg_dept_approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reg_dept_remarks         TEXT,
  ADD COLUMN IF NOT EXISTS reg_hr_approved_by       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reg_hr_approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reg_hr_remarks           TEXT;

COMMENT ON COLUMN attendance.regularization_status IS
  'N/A, Pending, Manager_Approved, Dept_Approved, Approved, Rejected';
