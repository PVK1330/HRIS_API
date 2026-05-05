CREATE TABLE IF NOT EXISTS public.settings (
    id          SERIAL PRIMARY KEY,
    key         VARCHAR(100) UNIQUE NOT NULL,
    value       TEXT,
    "group"     VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_group ON public.settings ("group");
CREATE INDEX IF NOT EXISTS idx_settings_key   ON public.settings (key);

-- Auto-update updated_at on row UPDATE
CREATE OR REPLACE FUNCTION update_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settings_updated_at ON public.settings;
CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON public.settings
    FOR EACH ROW EXECUTE FUNCTION update_settings_updated_at();

-- Seed default values (idempotent)
INSERT INTO public.settings (key, value, "group") VALUES
    ('default_language',      'English',  'general'),
    ('timezone',              'UTC',      'general'),
    ('date_format',           'd-m-Y',    'general'),
    ('date_selector_format',  'dd-mm-yyyy','general'),
    ('renewal_grace_period',  '3',        'general'),
    ('terms_of_service',      'false',    'general'),

    ('company_name',          '',         'company'),
    ('company_address',       '',         'company'),
    ('company_city',          '',         'company'),
    ('company_state',         '',         'company'),
    ('company_zip',           '',         'company'),
    ('company_country',       '',         'company'),
    ('company_telephone',     '',         'company'),

    ('system_email',          '',         'email'),
    ('system_from_name',      '',         'email'),
    ('email_delivery',        'smtp',     'email'),
    ('smtp_host',             '',         'email'),
    ('smtp_port',             '587',      'email'),
    ('smtp_username',         '',         'email'),
    ('smtp_password',         '',         'email'),
    ('smtp_encryption',       'tls',      'email'),

    ('logo_large',            '',         'logo'),
    ('logo_small',            '',         'logo'),
    ('logo_favicon',          '',         'logo')
ON CONFLICT (key) DO NOTHING;
