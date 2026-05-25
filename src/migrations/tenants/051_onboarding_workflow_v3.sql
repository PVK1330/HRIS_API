-- 3-step onboarding workflow: offer → signed offer → document checklist → complete

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS onboarding_workflow_status VARCHAR(64) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS onboarding_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS onboarding_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_letter_document_id INTEGER,
  ADD COLUMN IF NOT EXISTS signed_offer_document_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_onboarding_token
  ON employees (onboarding_token)
  WHERE onboarding_token IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN employees.onboarding_workflow_status IS
  'draft | offer_sent | rejected | accepted_pending_upload | documents_pending | onboarding_complete';

CREATE TABLE IF NOT EXISTS onboarding_checklist (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_key VARCHAR(64) NOT NULL,
  document_label VARCHAR(128) NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'Pending',
  hr_review_status VARCHAR(32) NOT NULL DEFAULT 'Pending',
  hr_review_comment TEXT,
  document_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, document_key)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_employee
  ON onboarding_checklist (employee_id);
