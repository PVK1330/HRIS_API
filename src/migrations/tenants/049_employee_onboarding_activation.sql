-- Track onboarding completion and portal invite

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS portal_invite_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_employees_onboarding_status
    ON employees (employment_status)
    WHERE deleted_at IS NULL;
