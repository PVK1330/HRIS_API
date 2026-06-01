-- Phase 5: Template selection rules per organization

ALTER TABLE exit_workflows
  ADD COLUMN IF NOT EXISTS applies_to_exit_type VARCHAR(50) DEFAULT 'Any',
  ADD COLUMN IF NOT EXISTS applies_to_termination_type_id INTEGER REFERENCES termination_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exit_workflows_applies
  ON exit_workflows (tenant_id, applies_to_exit_type, is_published)
  WHERE deleted_at IS NULL;
