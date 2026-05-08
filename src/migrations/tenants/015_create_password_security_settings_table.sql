-- 015_create_password_security_settings_table.sql
-- Tenant-scoped password & account security policies

CREATE TABLE IF NOT EXISTS password_security_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  minimum_length INTEGER DEFAULT 8,
  must_include_special_chars BOOLEAN DEFAULT false,
  password_expiry_days INTEGER DEFAULT 90,
  two_factor_auth BOOLEAN DEFAULT false,

  auto_logout_minutes INTEGER DEFAULT 30,
  max_login_attempt_limit INTEGER DEFAULT 5,
  blocked_account_recovery VARCHAR(30) DEFAULT 'Email recovery',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_password_security_settings_updated_at
  BEFORE UPDATE ON password_security_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO password_security_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM password_security_settings LIMIT 1);
