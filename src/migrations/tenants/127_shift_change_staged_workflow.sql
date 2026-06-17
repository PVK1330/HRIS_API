-- 127_shift_change_staged_workflow.sql
-- Upgrade shift_change_requests to a hierarchy-aware staged approval workflow,
-- mirroring the attendance regularization / overtime column-based pattern:
--   Stage 1 -> Reporting Manager  (pruned if the employee has no manager)
--   Stage 2 -> HR / Admin (final)
-- The overall `status` stays 'Pending' while in-flight and becomes
-- 'Approved' / 'Rejected' only when the chain completes.

ALTER TABLE shift_change_requests
  ADD COLUMN IF NOT EXISTS current_stage      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS manager_status     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS manager_acted_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_acted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hr_status          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hr_acted_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_acted_at        TIMESTAMPTZ;

-- Backfill the stage for any rows created before this migration. Pending rows
-- start at the reporting-manager stage when a manager exists, otherwise HR.
UPDATE shift_change_requests scr
   SET current_stage = CASE
         WHEN e.reporting_manager_id IS NOT NULL THEN 'manager'
         ELSE 'hr'
       END
  FROM employees e
 WHERE e.id = scr.employee_id
   AND scr.status = 'Pending'
   AND scr.current_stage IS NULL;

-- Completed (already Approved/Rejected) rows have no further stage.
UPDATE shift_change_requests
   SET current_stage = 'done'
 WHERE status IN ('Approved', 'Rejected', 'Cancelled')
   AND current_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_shift_change_status_stage
  ON shift_change_requests (status, current_stage);
