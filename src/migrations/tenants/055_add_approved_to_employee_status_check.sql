-- ============================================================================
-- Migration: Add 'Approved' to Employee Status CHECK Constraint
-- Date: 2026-05-26
-- Description: Allows 'Approved' as a valid employee_status value
-- ============================================================================

-- Drop the existing constraint
ALTER TABLE employee_performance 
DROP CONSTRAINT IF EXISTS employee_performance_employee_status_check;

-- Add the new constraint with 'Approved' status included
ALTER TABLE employee_performance 
ADD CONSTRAINT employee_performance_employee_status_check 
CHECK (employee_status IN ('Not Started', 'In Progress', 'Completed', 'On Hold', 'Approved'));
