-- 102_regularization_stage_columns.sql
-- Converts attendance regularization from the multi-row attendance_regularization_steps
-- table to a single-record, column-based model on the attendance row.
-- Stage flow: Direct Manager -> Department Head -> HR (stages gated by approval_workflow_type
-- and by whether the employee has a reporting manager / department).
-- The legacy attendance_regularization_steps table is left intact for historical rows.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS reg_current_stage           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS manager_approval_status     VARCHAR(20) DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS manager_approved_by         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS department_approval_status  VARCHAR(20) DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS department_approved_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hr_approval_status          VARCHAR(20) DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS hr_approved_by              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_approved_at              TIMESTAMPTZ;

COMMENT ON COLUMN attendance.reg_current_stage IS
  'Current regularization approval stage: manager | department | hr | done';
