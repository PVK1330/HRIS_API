CREATE TABLE IF NOT EXISTS public.recaptcha_settings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_enabled            BOOLEAN      NOT NULL DEFAULT false,
    site_key              VARCHAR(255) NOT NULL DEFAULT '',
    secret_key            VARCHAR(255) NOT NULL DEFAULT '',
    last_verified_at      TIMESTAMPTZ,
    last_verified_status  VARCHAR(20)  NOT NULL DEFAULT 'untested',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_recaptcha_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recaptcha_settings_updated_at ON public.recaptcha_settings;
CREATE TRIGGER trg_recaptcha_settings_updated_at
    BEFORE UPDATE ON public.recaptcha_settings
    FOR EACH ROW EXECUTE FUNCTION update_recaptcha_settings_updated_at();

-- Seed exactly one row (singleton). Guarded with NOT EXISTS so re-running the
-- migration on an existing DB doesn't insert duplicates.
INSERT INTO public.recaptcha_settings (is_enabled, site_key, secret_key)
SELECT false, '', ''
WHERE NOT EXISTS (SELECT 1 FROM public.recaptcha_settings);
