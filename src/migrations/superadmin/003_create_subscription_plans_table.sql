-- 003_create_subscription_plans_table.sql
-- Creates subscription plans for the SaaS platform

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id SERIAL PRIMARY KEY,
    plan_code VARCHAR(100) UNIQUE NOT NULL,
    plan_name VARCHAR(150) NOT NULL,
    plan_description VARCHAR(150) NOT NULL,
    monthly_price DECIMAL(12,2) NOT NULL,
    annual_price DECIMAL(12,2) NOT NULL,
    user_quota INTEGER DEFAULT 0,
    storage_quota_gb INTEGER DEFAULT 0,
    company_quota INTEGER DEFAULT 1,
    trial_days INTEGER DEFAULT 0,
    support_level VARCHAR(50),
    is_popular BOOLEAN DEFAULT false,
    is_custom BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON public.subscription_plans (plan_code);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON public.subscription_plans (is_active);

-- Insert default plans
INSERT INTO public.subscription_plans (plan_name, plan_code, plan_description, user_quota, storage_quota_gb, monthly_price, annual_price) VALUES
('Starter', 'starter', 'For small teams', 10, 1, 29.00, 290.00),
('Growth', 'growth', 'For growing companies', 50, 5, 79.00, 790.00),
('Pro', 'pro', 'For larger organizations', 200, 20, 199.00, 1990.00),
('Enterprise', 'enterprise', 'Custom solutions', -1, -1, 499.00, 4990.00)
ON CONFLICT (plan_code) DO NOTHING;
