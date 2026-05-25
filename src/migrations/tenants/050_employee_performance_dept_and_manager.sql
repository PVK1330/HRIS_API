-- ============================================================================
-- Migration: Add department_id and manager_id to Employee Performance Table
-- Date: 2026-05-22
-- Description: Adds department_id and manager_id to employee_performance to track specific assessment context
-- ============================================================================

ALTER TABLE employee_performance
ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emp_performance_department ON employee_performance(department_id);
CREATE INDEX IF NOT EXISTS idx_emp_performance_manager ON employee_performance(manager_id);
