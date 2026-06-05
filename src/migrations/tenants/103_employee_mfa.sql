-- 103_employee_mfa.sql
-- Per-user two-factor authentication (TOTP / authenticator app) for portal users.
-- Each employee (and admin shadow-employee record) can self-enroll an authenticator.
--   mfa_pending_secret : secret generated during setup, not yet confirmed
--   mfa_secret         : active confirmed secret used to verify codes at login
--   mfa_enabled        : true once the user has confirmed a code during enrollment

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS mfa_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret          TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret  TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at     TIMESTAMPTZ;
