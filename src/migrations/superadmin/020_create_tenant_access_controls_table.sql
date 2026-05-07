-- 020_create_tenant_access_controls_table.sql
-- Migration to create the tenant_access_controls table in the public schema

CREATE TABLE IF NOT EXISTS public.tenant_access_controls (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES public.subscription_plans(id),
    feature_id INTEGER NOT NULL REFERENCES public.platform_features(id),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_access_tenant_id ON public.tenant_access_controls(tenant_id);
