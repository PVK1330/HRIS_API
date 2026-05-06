-- 005_create_tenant_settings_table.sql
-- Stores tenant-specific configuration settings

CREATE TABLE IF NOT EXISTS public.tenant_settings (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    key             VARCHAR(100) NOT NULL,
    value           TEXT,
    category        VARCHAR(50),
    is_encrypted    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant_id ON public.tenant_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_category ON public.tenant_settings (category);

-- Add timezone column to tenants table
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) DEFAULT 'DD/MM/YYYY';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS time_format VARCHAR(10) DEFAULT '24h';
