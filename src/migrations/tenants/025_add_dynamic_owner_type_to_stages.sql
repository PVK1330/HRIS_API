ALTER TABLE exit_workflow_stages 
ADD COLUMN IF NOT EXISTS dynamic_owner_type VARCHAR(30) DEFAULT NULL;
