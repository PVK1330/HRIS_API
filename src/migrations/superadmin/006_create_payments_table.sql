-- 006_create_payments_table.sql
-- Tracks manual payments for tenant subscriptions

CREATE TABLE IF NOT EXISTS public.payments (
    id                  SERIAL PRIMARY KEY,
    tenant_id           INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    subscription_id     INTEGER REFERENCES public.tenant_subscriptions(id) ON DELETE SET NULL,
    
    -- Payment Details
    amount              DECIMAL(12,2) NOT NULL,
    currency            VARCHAR(10) NOT NULL DEFAULT 'AED',
    payment_method      VARCHAR(50) NOT NULL, -- Bank Transfer, Cash, Check, Credit Card, Other
    payment_reference   VARCHAR(255), -- Transaction ID, Check number, etc.
    
    -- Billing Period
    billing_start_date  DATE NOT NULL,
    billing_end_date    DATE NOT NULL,
    
    -- Status
    status              VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    
    -- Processing
    processed_by        INTEGER REFERENCES public.superadmins(id) ON DELETE SET NULL,
    processed_at        TIMESTAMPTZ,
    notes               TEXT,
    receipt_url         VARCHAR(500),
    
    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON public.payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON public.payments (subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_billing_period ON public.payments (billing_start_date, billing_end_date);

-- Create trigger function if not exists
CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION update_payments_updated_at();
