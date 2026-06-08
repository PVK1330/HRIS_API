-- 022_create_refresh_tokens_table.sql
-- Server-side refresh token store for all user types (tenant admins, employees, superadmins).
-- Each row is one issued refresh JWT, identified by its jti claim.
-- Revocation: mark revoked = TRUE. Token reuse detection: if a revoked jti arrives,
-- all tokens for that user are revoked (indicates a stolen refresh token scenario).

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  jti        UUID        PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  role       TEXT        NOT NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Fast lookup on active (non-revoked) tokens approaching expiry for cleanup jobs.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
  ON public.refresh_tokens (expires_at)
  WHERE revoked = FALSE;

-- Fast revocation check by user (used during reuse-attack global revocation).
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON public.refresh_tokens (user_id, role)
  WHERE revoked = FALSE;
