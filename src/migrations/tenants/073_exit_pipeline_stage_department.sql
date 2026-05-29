-- Each exit pipeline stage can be assigned to a department (Settings UI)

ALTER TABLE exit_pipeline_stages
  ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exit_pipeline_stages_department
  ON exit_pipeline_stages(department_id)
  WHERE department_id IS NOT NULL;
