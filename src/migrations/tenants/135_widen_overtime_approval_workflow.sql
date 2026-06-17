-- 135_widen_overtime_approval_workflow.sql
-- overtime_approval_workflow was VARCHAR(30), too short for full-label strings
-- like 'Reporting Manager → Dept Head → HR' (35 chars).
-- Widen to TEXT to match approver column (migration 134).

ALTER TABLE attendance_settings
  ALTER COLUMN overtime_approval_workflow TYPE TEXT;
