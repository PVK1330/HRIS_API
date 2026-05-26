-- ============================================================================
-- Migration: Add Approval Fields to Employee Performance
-- Date: 2026-05-25
-- Description: Adds approved_by and approved_at columns to track assessment approvals
-- ============================================================================

-- Add approval columns if they don't exist
ALTER TABLE employee_performance
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Create index for approved_by lookups
CREATE INDEX IF NOT EXISTS idx_emp_performance_approved_by ON employee_performance(approved_by);
CREATE INDEX IF NOT EXISTS idx_emp_performance_approved_at ON employee_performance(approved_at);
