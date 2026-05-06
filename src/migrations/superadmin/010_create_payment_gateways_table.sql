CREATE TABLE IF NOT EXISTS public.payment_gateways (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  VARCHAR(50) UNIQUE NOT NULL,
    name                  VARCHAR(100) NOT NULL,
    is_enabled            BOOLEAN      NOT NULL DEFAULT false,
    credentials           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    test_mode             BOOLEAN      NOT NULL DEFAULT true,
    last_verified_at      TIMESTAMPTZ,
    last_verified_status  VARCHAR(20),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_gateways_slug ON public.payment_gateways (slug);

CREATE OR REPLACE FUNCTION update_payment_gateways_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_gateways_updated_at ON public.payment_gateways;
CREATE TRIGGER trg_payment_gateways_updated_at
    BEFORE UPDATE ON public.payment_gateways
    FOR EACH ROW EXECUTE FUNCTION update_payment_gateways_updated_at();

INSERT INTO public.payment_gateways (slug, name, credentials) VALUES
    ('stripe',   'Stripe',           '{"publishable_key":"","secret_key":"","webhook_secret":""}'::jsonb),
    ('paypal',   'PayPal',           '{"client_id":"","client_secret":"","mode":"sandbox"}'::jsonb),
    ('razorpay', 'Razorpay',         '{"key_id":"","key_secret":"","webhook_secret":""}'::jsonb),
    ('offline',  'Offline Transfer', '{"bank_name":"","account_number":"","ifsc_code":"","account_holder":"","instructions":""}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
