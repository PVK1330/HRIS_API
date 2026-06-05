-- 025_add_dynamic_owner_type_to_stages.sql
-- Adds dynamic_owner_type to exit_workflow_stages.
-- NOTE: exit_workflow_stages is actually created later (migration 080), so on a
-- FRESH tenant this migration runs before the table exists. Guard it so it is a
-- no-op when the table is absent; the column is (re)added after creation by
-- migration 105. (Existing tenants already applied this when the table existed.)
DO $$
BEGIN
  IF to_regclass('public.exit_workflow_stages') IS NOT NULL THEN
    ALTER TABLE exit_workflow_stages
      ADD COLUMN IF NOT EXISTS dynamic_owner_type VARCHAR(30) DEFAULT NULL;
  END IF;
END $$;
