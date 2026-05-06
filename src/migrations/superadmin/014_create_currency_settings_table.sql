-- Default currency presentation (singleton row).

CREATE TABLE IF NOT EXISTS public.currency_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_currency VARCHAR(10) DEFAULT 'USD',
  currency_symbol VARCHAR(5) DEFAULT '$',
  symbol_position VARCHAR(20) DEFAULT 'before',
  decimal_separator VARCHAR(5) DEFAULT '.',
  thousand_separator VARCHAR(5) DEFAULT ',',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.currency_settings (
  default_currency,
  currency_symbol,
  symbol_position,
  decimal_separator,
  thousand_separator
)
SELECT 'USD', '$', 'before', '.', ','
WHERE NOT EXISTS (SELECT 1 FROM public.currency_settings LIMIT 1);
