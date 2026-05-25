-- ============================================================================
-- Migration: Alter Employee Progress to VARCHAR
-- ============================================================================

ALTER TABLE employee_performance DROP CONSTRAINT IF EXISTS employee_performance_employee_progress_check;
ALTER TABLE employee_performance ALTER COLUMN employee_progress TYPE VARCHAR(50) USING employee_progress::VARCHAR;
ALTER TABLE employee_performance ALTER COLUMN employee_progress SET DEFAULT '0';
