-- Exchange rates are now fetched from a live market provider instead of being
-- entered manually. Track when/where the cached rates came from.

ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS rates_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rates_source     VARCHAR(50);
