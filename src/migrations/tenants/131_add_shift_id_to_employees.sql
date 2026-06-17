-- 131_add_shift_id_to_employees.sql
-- Add direct shift FK on employees so the current shift is a single column lookup
-- rather than requiring a join to employee_shift_assignments.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;
