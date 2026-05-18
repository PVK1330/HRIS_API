-- ============================================================================
-- Migration: Create Employee Performance Table
-- Date: 2026-05-18
-- Description: Creates the employee_performance table for managing employee assessments
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_performance (
  id SERIAL PRIMARY KEY,
  
  -- Foreign Keys
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  performance_cycle_id INTEGER NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
  
  -- Assessment Fields
  competency_ratings JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall_rating DECIMAL(3, 2),
  key_contributions TEXT,
  growth_objectives TEXT,
  performance_band VARCHAR(50) CHECK (performance_band IN ('Outstanding', 'Exceeds', 'Meets', 'Needs Improvement')),
  performance_lead VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  
  -- Audit Fields
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_emp_performance_employee ON employee_performance(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_performance_cycle ON employee_performance(performance_cycle_id);
CREATE INDEX IF NOT EXISTS idx_emp_performance_status ON employee_performance(status);
CREATE INDEX IF NOT EXISTS idx_emp_performance_deleted ON employee_performance(deleted_at);

-- Trigger for auto updated_at
DROP TRIGGER IF EXISTS trigger_update_emp_performance_timestamp ON employee_performance;
CREATE TRIGGER trigger_update_emp_performance_timestamp
  BEFORE UPDATE ON employee_performance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
