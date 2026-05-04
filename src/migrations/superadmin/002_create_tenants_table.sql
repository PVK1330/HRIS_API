-- 002_create_tenants_table.sql
-- Creates the tenants registry table (one row per tenant / Admin organization).

DROP TABLE IF EXISTS public.tenants CASCADE;

CREATE TABLE public.tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    schema_name         VARCHAR(63)  UNIQUE NOT NULL,
    admin_email         VARCHAR(255) UNIQUE NOT NULL,
    admin_name          VARCHAR(255),
    admin_phone         VARCHAR(50),
    
    -- Company Information
    company_name        VARCHAR(255) NOT NULL,
    company_legal_name  VARCHAR(255),
    industry            VARCHAR(100),
    company_size        VARCHAR(50), -- 1-10, 11-50, 51-200, 201-500, 500+
    business_type       VARCHAR(50), -- LLC, Corporation, Partnership, Sole Proprietorship
    tax_id              VARCHAR(100),
    registration_number VARCHAR(100),
    website             VARCHAR(255),
    
    -- Address
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    country             VARCHAR(100) NOT NULL DEFAULT 'United Arab Emirates',
    postal_code         VARCHAR(20),
    
    -- Subscription
    plan_id             UUID,
    subscription_status VARCHAR(32) NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
    trial_ends_at       TIMESTAMPTZ,
    
    -- Timezone & Locale
    timezone            VARCHAR(50) DEFAULT 'UTC',
    date_format         VARCHAR(20) DEFAULT 'DD/MM/YYYY',
    time_format         VARCHAR(10) DEFAULT '24h',
    
    -- Status
    status              VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    onboarding_status   VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'in_progress', 'completed')),
    
    -- Audit
    created_by          UUID REFERENCES public.superadmins(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_admin_email ON public.tenants (admin_email);
CREATE INDEX idx_tenants_schema_name ON public.tenants (schema_name);
CREATE INDEX idx_tenants_status ON public.tenants (status);
CREATE INDEX idx_tenants_subscription_status ON public.tenants (subscription_status);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_tenants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tenants_updated_at ON public.tenants;
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION update_tenants_updated_at();
