-- Correct employment status for employees who completed resignation exits
UPDATE employees e
SET employment_status = 'Resigned', updated_at = NOW()
FROM exit_records er
WHERE er.employee_id = e.id
  AND er.exit_type = 'Resignation'
  AND er.status = 'Completed'
  AND e.employment_status = 'Terminated';

-- Align pipeline stage for completed exits
UPDATE exit_records
SET pipeline_stage = 'exited', updated_at = NOW()
WHERE status = 'Completed'
  AND (pipeline_stage IS NULL OR pipeline_stage <> 'exited');
