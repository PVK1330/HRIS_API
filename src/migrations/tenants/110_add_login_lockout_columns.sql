-- 110_add_login_lockout_columns.sql
-- Track failed login attempts and temporary lockout for org admins and employees.
-- max_login_attempt_limit is read from password_security_settings (default 5).
-- locked_until is set to NOW() + 15 min when the limit is reached and auto-expires.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_admin_users_locked_until
  ON admin_users (locked_until) WHERE locked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_locked_until
  ON employees (locked_until) WHERE locked_until IS NOT NULL;
