-- ============================================================================
-- Migration: Add Employee Progress Fields to Employee Performance
-- ============================================================================

ALTER TABLE employee_performance
ADD COLUMN IF NOT EXISTS employee_status VARCHAR(50) DEFAULT 'Not Started' CHECK (employee_status IN ('Not Started', 'In Progress', 'Completed', 'On Hold')),
ADD COLUMN IF NOT EXISTS employee_progress INTEGER DEFAULT 0 CHECK (employee_progress >= 0 AND employee_progress <= 100),
ADD COLUMN IF NOT EXISTS employee_comments TEXT,
ADD COLUMN IF NOT EXISTS completion_notes TEXT,
ADD COLUMN IF NOT EXISTS employee_updated_at TIMESTAMPTZ;
