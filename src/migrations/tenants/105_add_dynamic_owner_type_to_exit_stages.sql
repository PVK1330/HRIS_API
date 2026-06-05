-- 105_add_dynamic_owner_type_to_exit_stages.sql
-- Re-adds dynamic_owner_type AFTER exit_workflow_stages is created (migration 080).
-- Migration 025 (which originally added this column) is a no-op on fresh tenants
-- because it runs before the table exists. This guarantees the column is present
-- for every tenant. Idempotent (ADD COLUMN IF NOT EXISTS) for existing tenants.

ALTER TABLE exit_workflow_stages
  ADD COLUMN IF NOT EXISTS dynamic_owner_type VARCHAR(30) DEFAULT NULL;
