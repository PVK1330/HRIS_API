-- 024_add_locations_to_settings.sql

ALTER TABLE tenant_admin_settings ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb;
