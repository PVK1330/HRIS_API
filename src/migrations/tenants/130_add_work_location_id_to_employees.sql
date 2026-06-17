-- 130_add_work_location_id_to_employees.sql
-- Add FK column so employees can reference a location row by ID.
-- Keeps the existing work_location text column for backwards compatibility.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
