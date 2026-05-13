-- 035_hris_listing_export_extensions.sql
-- Columns and indexes for listing/export parity with HRIS modules spec

-- Departments: lifecycle status + optional manager employee id string
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE departments
SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
WHERE status IS DISTINCT FROM CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS manager_emp_id VARCHAR(50);

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS created_by INTEGER;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS employee_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_departments_status'
  ) THEN
    ALTER TABLE departments
      ADD CONSTRAINT chk_departments_status
      CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

-- Designations: grade + denormalized department label for faster filters/exports
ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS grade VARCHAR(20);

ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS department_name VARCHAR(150);

ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS employee_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS created_by INTEGER;

UPDATE designations ds
SET department_name = d.name
FROM departments d
WHERE d.id = ds.department_id
  AND (ds.department_name IS NULL OR ds.department_name = '');

UPDATE designations
SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
WHERE status IS DISTINCT FROM CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_designations_status'
  ) THEN
    ALTER TABLE designations
      ADD CONSTRAINT chk_designations_status
      CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_designations_department_name ON designations (department_name);
CREATE INDEX IF NOT EXISTS idx_designations_grade ON designations (grade);
