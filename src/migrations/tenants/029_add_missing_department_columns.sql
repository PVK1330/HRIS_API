-- 029_add_missing_department_columns.sql

ALTER TABLE departments 
  ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS head_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS budget DECIMAL(15, 2);
