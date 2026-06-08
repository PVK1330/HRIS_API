-- 028_password_resets_attempts.sql
-- Track failed OTP verification attempts per reset record so the OTP can be
-- invalidated after too many wrong guesses (brute-force protection).

ALTER TABLE public.password_resets
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
