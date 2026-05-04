-- 009_create_exit_management_table.sql
-- Exit management and offboarding

CREATE TABLE IF NOT EXISTS exit_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    exit_type           VARCHAR(50) NOT NULL, -- Resignation, Termination, Retirement, Contract End
    last_working_day    DATE NOT NULL,
    notice_period_days  INTEGER,
    exit_reason         TEXT,
    exit_interview_date DATE,
    exit_interview_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
    exit_interview_notes TEXT,
    
    -- Clearance checklist
    it_assets_returned  BOOLEAN NOT NULL DEFAULT false,
    access_revoked      BOOLEAN NOT NULL DEFAULT false,
    final_settlement_processed BOOLEAN NOT NULL DEFAULT false,
    noc_issued          BOOLEAN NOT NULL DEFAULT false,
    experience_letter_issued BOOLEAN NOT NULL DEFAULT false,
    
    status              VARCHAR(50) NOT NULL DEFAULT 'Notice', -- Notice, Offboarding, Closed
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_records_employee_id ON exit_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_exit_records_status ON exit_records (status);
CREATE INDEX IF NOT EXISTS idx_exit_records_last_day ON exit_records (last_working_day);

CREATE TRIGGER update_exit_records_updated_at BEFORE UPDATE ON exit_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Asset return tracking
CREATE TABLE IF NOT EXISTS asset_returns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exit_record_id      UUID NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    asset_name          VARCHAR(255) NOT NULL,
    asset_code          VARCHAR(50),
    asset_type          VARCHAR(100), -- Laptop, Monitor, Phone, Access Card, etc.
    condition_on_return VARCHAR(100),
    return_date         DATE,
    returned_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
    notes               TEXT,
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Returned, Lost, Damaged
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_returns_exit_record_id ON asset_returns (exit_record_id);
