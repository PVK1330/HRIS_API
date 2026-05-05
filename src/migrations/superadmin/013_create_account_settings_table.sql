-- Platform account governance (singleton row).
-- Seeds one row if the table is empty (ON CONFLICT is not used — no natural unique key).

CREATE TABLE IF NOT EXISTS public.account_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_registration BOOLEAN DEFAULT false,
  email_verification BOOLEAN DEFAULT false,
  two_factor_auth BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.account_settings (public_registration, email_verification, two_factor_auth)
SELECT false, false, false
WHERE NOT EXISTS (SELECT 1 FROM public.account_settings LIMIT 1);
