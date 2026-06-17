-- Ensure employee_salaries has a unique constraint on employee_id
-- so that the ON CONFLICT (employee_id) upsert works correctly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_salaries_employee_id_key'
      AND conrelid = 'employee_salaries'::regclass
  ) THEN
    ALTER TABLE employee_salaries ADD CONSTRAINT employee_salaries_employee_id_key UNIQUE (employee_id);
  END IF;
END $$;
