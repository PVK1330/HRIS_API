-- 013_alter_letter_templates_add_columns.sql
-- Add type, description, usage_count to existing letter_templates table

ALTER TABLE letter_templates
  ADD COLUMN IF NOT EXISTS type        VARCHAR(50)  NOT NULL DEFAULT 'Letter',
  ADD COLUMN IF NOT EXISTS description TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS usage_count INTEGER      NOT NULL DEFAULT 0;

-- Expand category to support Leave and Disciplinary (drop old constraint if exists)
ALTER TABLE letter_templates
  DROP CONSTRAINT IF EXISTS letter_templates_category_check;
