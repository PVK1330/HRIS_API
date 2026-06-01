-- Tenant migration: add super_admin_description column to support_tickets
-- Adds a text column for superadmin notes if it doesn't already exist

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS super_admin_description TEXT;
