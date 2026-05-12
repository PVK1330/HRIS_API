-- 034: Restore optional department manager FK, designation description,
-- widen profile image storage, and add employee listing indexes.

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE employees
  ALTER COLUMN profile_image_url TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_list_emp_id ON employees (emp_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_list_work_email ON employees (work_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_list_department ON employees (department) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_list_employment_status ON employees (employment_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_list_join_date ON employees (join_date) WHERE deleted_at IS NULL;
