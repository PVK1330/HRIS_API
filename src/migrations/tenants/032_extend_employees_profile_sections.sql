-- 032_extend_employees_profile_sections.sql
-- Extended profile: bank, family JSON, contacts JSON, education, prior experience, misc personal

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS username VARCHAR(120),
  ADD COLUMN IF NOT EXISTS religion VARCHAR(150),
  ADD COLUMN IF NOT EXISTS employment_spouse VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bank_account_no VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ifsc_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS branch_address TEXT,
  ADD COLUMN IF NOT EXISTS family_members JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS secondary_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS education JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS work_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_currently_working BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_employees_username ON employees (username) WHERE username IS NOT NULL;
