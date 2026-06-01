-- 079_drop_legacy_exit_tables.sql
-- Greenfield removal of the old fixed-pipeline + dual-state exit schema.
-- No data backfill (locked decision: no production exit data).
-- CASCADE clears dependent FKs/views/triggers. Order is child-first defensively;
-- CASCADE makes strict ordering non-fatal but we keep it tidy.

BEGIN;

-- Pipeline-stage config (072/073/074)
DROP TABLE IF EXISTS exit_pipeline_stage_departments CASCADE;
DROP TABLE IF EXISTS exit_pipeline_stages            CASCADE;

-- 071 department-workflow + logs + org template
DROP TABLE IF EXISTS exit_organization_workflow_templates CASCADE;
DROP TABLE IF EXISTS exit_status_logs                CASCADE;
DROP TABLE IF EXISTS exit_approvals                  CASCADE;  -- 071 shape; name reused by 080
DROP TABLE IF EXISTS exit_department_workflows       CASCADE;

-- Stage-attached legacy data (009/060/061/062/063)
DROP TABLE IF EXISTS exit_documents          CASCADE;
DROP TABLE IF EXISTS exit_interviews         CASCADE;
DROP TABLE IF EXISTS final_settlements       CASCADE;
DROP TABLE IF EXISTS clearance_tasks         CASCADE;
DROP TABLE IF EXISTS clearance_task_templates CASCADE;
DROP TABLE IF EXISTS asset_returns           CASCADE;
DROP TABLE IF EXISTS exit_audit_logs         CASCADE;  -- both 061 and 066 shapes

-- Core record table + lookup
DROP TABLE IF EXISTS exit_records     CASCADE;
DROP TABLE IF EXISTS termination_types CASCADE;  -- re-created fresh in 080 as a lookup

-- Defensive guard-drop of the legacy 066 enterprise engine (already dropped by 071
-- on most tenants, but harmless if a DB predates 071). 'exit_workflows' name is reused.
DROP TABLE IF EXISTS exit_workflow_form_submissions   CASCADE;
DROP TABLE IF EXISTS exit_workflow_instance_steps     CASCADE;
DROP TABLE IF EXISTS exit_workflow_instances          CASCADE;
DROP TABLE IF EXISTS workflow_form_fields             CASCADE;
DROP TABLE IF EXISTS workflow_step_forms              CASCADE;
DROP TABLE IF EXISTS exit_workflow_step_assignees     CASCADE;
DROP TABLE IF EXISTS exit_workflow_steps              CASCADE;
DROP TABLE IF EXISTS exit_workflows                   CASCADE;  -- name reused by 080
DROP TABLE IF EXISTS exit_workflow_stages             CASCADE;  -- guard (name reused by 080)

-- New-engine tables (guard-drop so this migration set is re-runnable on a half-built tenant)
DROP TABLE IF EXISTS exit_request_checklist_items CASCADE;
DROP TABLE IF EXISTS exit_request_attachments     CASCADE;
DROP TABLE IF EXISTS exit_stage_checklist_items   CASCADE;
DROP TABLE IF EXISTS exit_stage_users             CASCADE;
DROP TABLE IF EXISTS exit_stage_roles             CASCADE;
DROP TABLE IF EXISTS exit_stage_departments       CASCADE;
DROP TABLE IF EXISTS exit_requests                CASCADE;

COMMIT;
