CREATE TABLE IF NOT EXISTS public.free_trial_settings (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trial_enabled             BOOLEAN     NOT NULL DEFAULT false,
    trial_days                INTEGER     NOT NULL DEFAULT 14,
    mandatory_payment_method  BOOLEAN     NOT NULL DEFAULT false,
    max_tenants_per_identity  INTEGER     NOT NULL DEFAULT 1,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_free_trial_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_free_trial_settings_updated_at ON public.free_trial_settings;
CREATE TRIGGER trg_free_trial_settings_updated_at
    BEFORE UPDATE ON public.free_trial_settings
    FOR EACH ROW EXECUTE FUNCTION update_free_trial_settings_updated_at();

-- Seed singleton row.
INSERT INTO public.free_trial_settings
    (trial_enabled, trial_days, mandatory_payment_method, max_tenants_per_identity)
SELECT false, 14, false, 1
WHERE NOT EXISTS (SELECT 1 FROM public.free_trial_settings);
