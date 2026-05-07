-- 016_fix_subscription_plans_schema.sql
-- Renames columns in subscription_plans to match the codebase expectations
-- Uses dynamic SQL to avoid parsing errors when columns are already renamed

DO $$ 
BEGIN
    -- Rename name to plan_name
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='name') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN "name" TO plan_name';
    END IF;

    -- Rename code to plan_code
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='code') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN "code" TO plan_code';
    END IF;

    -- Rename description to plan_description
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='description') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN "description" TO plan_description';
    END IF;

    -- Rename max_users to user_quota
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='max_users') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN max_users TO user_quota';
    END IF;

    -- Rename price_monthly to monthly_price
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='price_monthly') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN price_monthly TO monthly_price';
    END IF;

    -- Rename price_yearly to annual_price
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='price_yearly') THEN
        EXECUTE 'ALTER TABLE public.subscription_plans RENAME COLUMN price_yearly TO annual_price';
    END IF;

    -- Handle storage conversion (MB to GB)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='max_storage_mb') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='storage_quota_gb') THEN
            ALTER TABLE public.subscription_plans ADD COLUMN storage_quota_gb INTEGER;
        END IF;
        UPDATE public.subscription_plans SET storage_quota_gb = CASE WHEN max_storage_mb = -1 THEN -1 ELSE max_storage_mb / 1024 END;
        EXECUTE 'ALTER TABLE public.subscription_plans DROP COLUMN max_storage_mb';
    END IF;

END $$;

-- Add missing columns if they don't exist (these use IF NOT EXISTS natively)
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS storage_quota_gb INTEGER;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS company_quota INTEGER DEFAULT 1;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS support_level VARCHAR(50);
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS is_popular BOOLEAN DEFAULT false;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;
