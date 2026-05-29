-- Link exit_records to workflow engine + snapshot support (Phase 1)

ALTER TABLE exit_records
  ADD COLUMN IF NOT EXISTS workflow_instance_id INTEGER;

ALTER TABLE exit_workflow_instances
  ADD COLUMN IF NOT EXISTS exit_record_id INTEGER REFERENCES exit_records(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB;

ALTER TABLE exit_workflow_instance_steps
  ADD COLUMN IF NOT EXISTS step_snapshot JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exit_records_workflow_instance_id_fkey'
  ) THEN
    ALTER TABLE exit_records
      ADD CONSTRAINT exit_records_workflow_instance_id_fkey
      FOREIGN KEY (workflow_instance_id) REFERENCES exit_workflow_instances(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_workflow_instances_exit_record
  ON exit_workflow_instances(exit_record_id)
  WHERE exit_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exit_records_workflow_instance
  ON exit_records(workflow_instance_id)
  WHERE workflow_instance_id IS NOT NULL;
