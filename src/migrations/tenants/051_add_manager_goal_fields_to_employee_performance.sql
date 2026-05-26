-- ============================================================================
-- Migration: Add Manager Goal Fields to Employee Performance Table
-- Date: 2026-05-23
-- Description: Adds nullable columns for manager goal details (goal_title, kpi_target, weightage, due_date, priority, manager_status)
-- ============================================================================

ALTER TABLE employee_performance
ADD COLUMN IF NOT EXISTS goal_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS kpi_target TEXT,
ADD COLUMN IF NOT EXISTS weightage INTEGER CHECK (weightage IS NULL OR (weightage >= 1 AND weightage <= 100)),
ADD COLUMN IF NOT EXISTS due_date DATE,
ADD COLUMN IF NOT EXISTS priority VARCHAR(50),
ADD COLUMN IF NOT EXISTS manager_status VARCHAR(50);

-- Create indexes for filtering by manager goal status
CREATE INDEX IF NOT EXISTS idx_emp_performance_goal_title ON employee_performance(goal_title);
CREATE INDEX IF NOT EXISTS idx_emp_performance_manager_status ON employee_performance(manager_status);
CREATE INDEX IF NOT EXISTS idx_emp_performance_has_goals ON employee_performance(id) WHERE goal_title IS NOT NULL OR kpi_target IS NOT NULL;
