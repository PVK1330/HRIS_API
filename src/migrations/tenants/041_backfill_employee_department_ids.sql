-- Backfill employees.department_id from departments.name / code (idempotent)

UPDATE employees e
SET department_id = d.id
FROM departments d
WHERE e.department_id IS NULL
  AND e.deleted_at IS NULL
  AND e.department IS NOT NULL
  AND TRIM(e.department) <> ''
  AND (
    LOWER(TRIM(e.department)) = LOWER(TRIM(d.name))
    OR LOWER(TRIM(e.department)) = LOWER(TRIM(COALESCE(d.code, '')))
  );
