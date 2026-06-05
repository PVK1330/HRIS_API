-- 104_admin_users_mfa.sql
-- Per-user two-factor authentication for ORGANIZATION ADMINS (admin_users).
-- Org admins are not employees, so their MFA secret is stored here directly rather
-- than relying on a shadow employee record (which may not always exist).

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS mfa_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret          TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret  TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at     TIMESTAMPTZ;
