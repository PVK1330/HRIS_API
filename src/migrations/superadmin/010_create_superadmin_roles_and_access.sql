-- 010_create_superadmin_roles_and_access.sql
-- Adds role/status tracking for superadmin users and introduces
-- a dedicated permissions model for superadmin panel RBAC.

ALTER TABLE public.superadmins
ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'superadmin',
ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.superadmin_roles (
    id SERIAL PRIMARY KEY,
    role_key VARCHAR(64) UNIQUE NOT NULL,
    role_name VARCHAR(128) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_superadmin_roles_role_key ON public.superadmin_roles (role_key);

INSERT INTO public.superadmin_roles (role_key, role_name, description, permissions, is_system)
VALUES
(
  'superadmin',
  'Super Admin',
  'Full platform control with unrestricted access.',
  '{
    "organization_management": true,
    "billing_revenue": true,
    "user_management": true,
    "system_config": true,
    "audit_logs": true,
    "support_tickets": true
  }'::jsonb,
  true
),
(
  'support_admin',
  'Support Admin',
  'Operational support and tenant assistance responsibilities.',
  '{
    "organization_management": true,
    "billing_revenue": false,
    "user_management": false,
    "system_config": false,
    "audit_logs": true,
    "support_tickets": true
  }'::jsonb,
  true
),
(
  'billing_admin',
  'Billing Admin',
  'Billing operations and subscription governance.',
  '{
    "organization_management": true,
    "billing_revenue": true,
    "user_management": false,
    "system_config": false,
    "audit_logs": false,
    "support_tickets": false
  }'::jsonb,
  true
)
ON CONFLICT (role_key) DO UPDATE
SET
    role_name = EXCLUDED.role_name,
    description = EXCLUDED.description,
    permissions = EXCLUDED.permissions,
    updated_at = NOW();
