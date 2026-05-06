-- 011_create_superadmin_modules_and_announcements.sql
-- Adds module flags and global announcement persistence for superadmin panel.

CREATE TABLE IF NOT EXISTS public.superadmin_modules (
    id SERIAL PRIMARY KEY,
    module_key VARCHAR(64) UNIQUE NOT NULL,
    module_name VARCHAR(128) NOT NULL,
    description TEXT,
    tier VARCHAR(32),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    scope VARCHAR(32) NOT NULL DEFAULT 'global',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_superadmin_modules_scope ON public.superadmin_modules (scope);
CREATE INDEX IF NOT EXISTS idx_superadmin_modules_key ON public.superadmin_modules (module_key);

INSERT INTO public.superadmin_modules (module_key, module_name, description, tier, is_enabled, scope)
VALUES
('employee_directory', 'Employee Directory', 'Core human resource directory and profile management.', 'Essential', TRUE, 'global'),
('attendance', 'Attendance & Timesheet', 'Real-time clock-in/out and automated timesheet generation.', 'Essential', TRUE, 'global'),
('leave', 'Leave Management', 'Policy-based leave requests and approval workflows.', 'Essential', TRUE, 'global'),
('payroll', 'Payroll & Salary', 'Automated salary calculation and pay slip generation.', 'Advanced', TRUE, 'global'),
('performance', 'Performance Management', 'KPI tracking, appraisal cycles, and feedback loops.', 'Strategic', TRUE, 'global'),
('onboarding_exit', 'Onboarding & Exit', 'Structured workflows for employee lifecycle transitions.', 'Strategic', TRUE, 'global'),
('api', 'Advanced API access', 'Secure GraphQL/REST endpoints for third-party integration.', 'Enterprise', TRUE, 'global'),
('visa', 'Visa & Nationality', NULL, NULL, TRUE, 'organization'),
('expenses', 'Expense Management', NULL, NULL, TRUE, 'organization'),
('asset_management', 'Asset Inventory', NULL, NULL, FALSE, 'organization'),
('api_override', 'Infrastructure API Override', NULL, NULL, FALSE, 'organization')
ON CONFLICT (module_key) DO UPDATE
SET
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    tier = EXCLUDED.tier,
    is_enabled = EXCLUDED.is_enabled,
    scope = EXCLUDED.scope,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.superadmin_announcements (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    audience VARCHAR(128) NOT NULL DEFAULT 'All Organizations',
    type VARCHAR(32) NOT NULL DEFAULT 'Info',
    sent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recipients INTEGER NOT NULL DEFAULT 48,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_superadmin_announcements_sent_date ON public.superadmin_announcements (sent_date DESC);
