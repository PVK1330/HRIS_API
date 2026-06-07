-- 107_overtime_multilevel_approval.sql
-- Three-stage overtime approval: Reporting Manager → Department Head → HR/Admin.
-- overtime_status flow:
--   None (no OT recorded)
--   → Pending            (awaiting Reporting Manager; or Dept Head if no manager assigned)
--   → Manager_Approved   (Reporting Manager approved; now awaiting Dept Head)
--   → Dept_Approved      (Dept Head approved; now awaiting HR final approval)
--   → Approved           (HR gave final sign-off)
--   → Rejected           (rejected at any stage)
--
-- Per-stage actor columns replace the single overtime_approved_by pattern so the full
-- audit trail is visible on the attendance row without joining a separate steps table.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS overtime_manager_approved_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overtime_manager_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overtime_manager_remarks      TEXT,
  ADD COLUMN IF NOT EXISTS overtime_dept_approved_by     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overtime_dept_approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overtime_dept_remarks         TEXT,
  ADD COLUMN IF NOT EXISTS overtime_hr_approved_by       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overtime_hr_approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overtime_hr_remarks           TEXT;

-- Update status enum comment to include new intermediate states.
COMMENT ON COLUMN attendance.overtime_status IS
  'None, Pending, Manager_Approved, Dept_Approved, Approved, Rejected';
