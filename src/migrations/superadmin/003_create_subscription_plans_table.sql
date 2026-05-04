-- 003_create_subscription_plans_table.sql
-- Creates subscription plans for the SaaS platform

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    code            VARCHAR(50)  NOT NULL UNIQUE,
    description     TEXT,
    max_users       INTEGER NOT NULL DEFAULT 10,
    max_storage_mb  INTEGER NOT NULL DEFAULT 1024,
    price_monthly   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    price_yearly    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    features        JSONB,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON public.subscription_plans (code);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON public.subscription_plans (is_active);

-- Insert default plans
INSERT INTO public.subscription_plans (name, code, description, max_users, max_storage_mb, price_monthly, price_yearly, features) VALUES
('Starter', 'starter', 'For small teams', 10, 1024, 29.00, 290.00, '["employee_directory", "attendance", "leave", "documents"]'::jsonb),
('Growth', 'growth', 'For growing companies', 50, 5120, 79.00, 790.00, '["employee_directory", "attendance", "leave", "documents", "performance", "visa", "policies"]'::jsonb),
('Pro', 'pro', 'For larger organizations', 200, 20480, 199.00, 1990.00, '["employee_directory", "attendance", "leave", "documents", "performance", "visa", "policies", "expenses", "onboarding", "exit"]'::jsonb),
('Enterprise', 'enterprise', 'Custom solutions', -1, -1, 499.00, 4990.00, '["all"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
