-- Add attachments support to policies
ALTER TABLE policies ADD COLUMN attachments JSONB DEFAULT '[]';
