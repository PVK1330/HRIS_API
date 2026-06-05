-- Extend the singleton currency settings with display precision, billing tax
-- (VAT/GST) and a manual exchange-rate table used to auto-convert amounts into
-- the platform's default currency.

ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS decimal_places  INTEGER       NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS tax_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_label       VARCHAR(20)   NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(7,3)  NOT NULL DEFAULT 0,
  -- Map of { "<CURRENCY_CODE>": <units of that currency per 1 unit of the
  -- default currency> }. The default currency itself is implicitly 1.
  ADD COLUMN IF NOT EXISTS exchange_rates  JSONB         NOT NULL DEFAULT '{}'::jsonb;

-- Keep tax_rate sane (0–100%).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'currency_settings_tax_rate_chk'
  ) THEN
    ALTER TABLE public.currency_settings
      ADD CONSTRAINT currency_settings_tax_rate_chk
      CHECK (tax_rate >= 0 AND tax_rate <= 100);
  END IF;
END$$;
