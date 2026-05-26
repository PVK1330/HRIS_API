-- 061_exit_management_v3.sql
-- Expand exit management: interviews, settlements, audit logs, UK compliance fields

-- Add new columns to exit_records for expanded workflow
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS initiated_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS is_voluntary BOOLEAN DEFAULT true;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS reason_detail TEXT;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS rtw_status VARCHAR(50) DEFAULT 'valid';
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS contract_notice_days INTEGER DEFAULT 0;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS statutory_notice_days INTEGER DEFAULT 0;

-- Add assigned_to_role to clearance_tasks for role-based toggling
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS assigned_to_role VARCHAR(50) DEFAULT 'hr';
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Exit interviews table
CREATE TABLE IF NOT EXISTS exit_interviews (
    id SERIAL PRIMARY KEY,
    exit_request_id INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    conducted_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    conducted_by_name VARCHAR(255),
    format VARCHAR(20) NOT NULL DEFAULT 'in_person' CHECK (format IN ('in_person', 'virtual', 'written')),
    feedback TEXT,
    rehire_eligible VARCHAR(10) DEFAULT 'maybe' CHECK (rehire_eligible IN ('yes', 'no', 'maybe')),
    overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
    conducted_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_interviews_request ON exit_interviews (exit_request_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_exit_interviews_updated_at'
  ) THEN
    CREATE TRIGGER update_exit_interviews_updated_at BEFORE UPDATE ON exit_interviews
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

-- Final settlements table
CREATE TABLE IF NOT EXISTS final_settlements (
    id SERIAL PRIMARY KEY,
    exit_request_id INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    unpaid_salary NUMERIC(12,2) DEFAULT 0,
    leave_encashment NUMERIC(12,2) DEFAULT 0,
    gratuity NUMERIC(12,2) DEFAULT 0,
    deductions NUMERIC(12,2) DEFAULT 0,
    net_payable NUMERIC(12,2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'processed')),
    payment_date DATE,
    processed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_final_settlements_request ON final_settlements (exit_request_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_final_settlements_updated_at'
  ) THEN
    CREATE TRIGGER update_final_settlements_updated_at BEFORE UPDATE ON final_settlements
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

-- Exit audit logs table
CREATE TABLE IF NOT EXISTS exit_audit_logs (
    id SERIAL PRIMARY KEY,
    exit_request_id INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    performed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    performed_by_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_audit_logs_request ON exit_audit_logs (exit_request_id);

-- Add generated_by to exit_documents
ALTER TABLE exit_documents ADD COLUMN IF NOT EXISTS generated_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
