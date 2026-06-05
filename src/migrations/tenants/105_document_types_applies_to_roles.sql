-- 105_document_types_applies_to_roles.sql
-- Role-based onboarding documents: which roles a document type applies to.
-- An empty array means the document applies to ALL roles (default).
-- Values are rbac_roles ids (as text) and/or role names.

ALTER TABLE document_types
  ADD COLUMN IF NOT EXISTS applies_to_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
