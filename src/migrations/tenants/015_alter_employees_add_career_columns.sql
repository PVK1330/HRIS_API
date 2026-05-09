-- 015_alter_employees_add_career_columns.sql
-- Add career_history, awards_summary, promotion_history columns to employees

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS career_history    TEXT,
  ADD COLUMN IF NOT EXISTS awards_summary    TEXT,
  ADD COLUMN IF NOT EXISTS promotion_history TEXT;
