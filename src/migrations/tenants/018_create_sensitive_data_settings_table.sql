-- 018_create_sensitive_data_settings_table.sql
-- Tenant-scoped visibility rules for salary, visa, documents, notes

CREATE TABLE IF NOT EXISTS sensitive_data_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  salary_breakup_visibility VARCHAR(100) DEFAULT 'HR Admin only',
  ctc_visibility VARCHAR(100) DEFAULT 'HR Admin only',
  payslips_visibility VARCHAR(100) DEFAULT 'HR Admin only',
  revisions_visibility VARCHAR(100) DEFAULT 'HR Admin only',
  payroll_reports_visibility VARCHAR(100) DEFAULT 'HR Admin only',

  visa_nationality_visibility JSONB DEFAULT $VIS$
{
  "HR Admin": "Full Access",
  "HR Executive": "Full Access",
  "Manager": "Hidden",
  "Employee": "Own info only"
}
$VIS$::jsonb,

  passport_copy_visibility VARCHAR(40) DEFAULT 'HR only',
  visa_copy_visibility VARCHAR(40) DEFAULT 'HR only',
  national_id_visibility VARCHAR(40) DEFAULT 'HR only',
  medical_documents_visibility VARCHAR(40) DEFAULT 'HR only',
  performance_issues_visibility VARCHAR(40) DEFAULT 'HR only',

  notes_visibility VARCHAR(40) DEFAULT 'HR only',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_sensitive_data_settings_updated_at
  BEFORE UPDATE ON sensitive_data_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO sensitive_data_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM sensitive_data_settings LIMIT 1);
