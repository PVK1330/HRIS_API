-- 022_add_department_id_to_employees.sql

ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees (department_id);

-- Optional: Migrate existing string-based department data to ID-based (best effort)
UPDATE employees e
SET department_id = d.id
FROM departments d
WHERE LOWER(TRIM(e.department)) = LOWER(TRIM(d.name))
   OR LOWER(TRIM(e.department)) = LOWER(TRIM(d.code));
