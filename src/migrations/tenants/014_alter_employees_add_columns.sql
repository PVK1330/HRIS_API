-- 014_alter_employees_add_columns.sql
-- Add work_mode, grade, cost_center, marital_status, dependents,
-- sponsoring_entity, country_of_residence columns to employees

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_mode           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS grade               VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cost_center         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS marital_status      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dependents          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsoring_entity   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS country_of_residence VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_employees_work_mode ON employees (work_mode);
