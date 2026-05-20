-- Policy publish audience targeting (departments, roles, new joiners)
ALTER TABLE policies ADD COLUMN IF NOT EXISTS audience_config JSONB DEFAULT '{"type":"all"}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_policies_audience_config ON policies USING gin (audience_config);
