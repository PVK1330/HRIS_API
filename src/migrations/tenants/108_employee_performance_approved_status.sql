-- ============================================================================
-- Migration: Allow 'Approved' employee_status on employee_performance
-- Description: EmployeePerformance.approve() sets employee_status = 'Approved',
--              which the CHECK constraint added in migration 052 did not permit.
--              This relaxes the constraint to include the terminal 'Approved'
--              state so admin approval succeeds.
-- ============================================================================

ALTER TABLE employee_performance
  DROP CONSTRAINT IF EXISTS employee_performance_employee_status_check;

ALTER TABLE employee_performance
  ADD CONSTRAINT employee_performance_employee_status_check
  CHECK (employee_status IN ('Not Started', 'In Progress', 'Completed', 'On Hold', 'Approved'));
