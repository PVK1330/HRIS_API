-- Onboarding workflow fields on employees

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS onboarding_approval_status VARCHAR(32) DEFAULT 'Pending',
    ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS onboarding_rejection_reason TEXT;

COMMENT ON COLUMN employees.onboarding_approval_status IS 'Pending | Accepted | Rejected';
COMMENT ON COLUMN employees.onboarding_step IS 'Last completed onboarding step (1=candidate submitted, 2=documents, etc.)';
