-- 015_create_plan_features_table.sql
-- Table to map subscription plans to platform features

CREATE TABLE IF NOT EXISTS public.subscription_plan_features (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES public.platform_features(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(plan_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id ON public.subscription_plan_features (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_features_feature_id ON public.subscription_plan_features (feature_id);
