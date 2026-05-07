-- 011_create_tenant_admin_settings_table.sql
-- Tenant-scoped admin settings (company profile, calendars, HR defaults)

CREATE TABLE IF NOT EXISTS tenant_admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) DEFAULT '',
  logo_url VARCHAR(500) DEFAULT '',
  address TEXT DEFAULT '',
  contact_details VARCHAR(100) DEFAULT '',
  country VARCHAR(100) DEFAULT '',
  timezone VARCHAR(100) DEFAULT 'UTC',
  financial_year_start VARCHAR(20) DEFAULT 'January 1',
  working_days JSONB DEFAULT '["M","T","W","T","F"]',
  default_work_calendar VARCHAR(50) DEFAULT 'Standard 9-6',
  regional_holidays_enabled BOOLEAN DEFAULT false,
  multiple_calendars_enabled BOOLEAN DEFAULT false,
  default_probation_period VARCHAR(20) DEFAULT '2 months',
  default_notice_period VARCHAR(20) DEFAULT '30 days',
  auto_assign_policies BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_tenant_admin_settings_updated_at
  BEFORE UPDATE ON tenant_admin_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed one default row per tenant (idempotent; remaining columns use table defaults)
INSERT INTO tenant_admin_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM tenant_admin_settings LIMIT 1);
