ALTER TABLE exit_workflow_stages DROP CONSTRAINT IF EXISTS chk_exit_stage_order;
ALTER TABLE exit_workflow_stages ADD CONSTRAINT chk_exit_stage_order CHECK (stage_order BETWEEN 1 AND 10);
