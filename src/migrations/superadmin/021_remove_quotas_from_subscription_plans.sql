-- 021_remove_quotas_from_subscription_plans.sql
-- Removes user_quota, storage_quota_gb, and company_quota from subscription_plans

ALTER TABLE public.subscription_plans
DROP COLUMN IF EXISTS user_quota,
DROP COLUMN IF EXISTS storage_quota_gb,
DROP COLUMN IF EXISTS company_quota;
