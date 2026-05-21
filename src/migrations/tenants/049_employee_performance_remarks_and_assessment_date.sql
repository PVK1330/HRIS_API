-- Migration: Add Remarks and Assessment Date to Employee Performance
-- Date: 2026-05-21
-- Description: Adds remarks and assessment_date columns to employee_performance table

ALTER TABLE employee_performance 
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS assessment_date TIMESTAMPTZ;
