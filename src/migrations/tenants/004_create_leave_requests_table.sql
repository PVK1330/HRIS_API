-- 004_create_leave_requests_table.sql
-- Leave and absence management

CREATE TABLE IF NOT EXISTS leave_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type          VARCHAR(50) NOT NULL, -- Annual Leave, Sick Leave, Casual Leave, Maternity, Paternity, Emergency, Unpaid, Compensatory Off, Study Leave
    from_date           DATE NOT NULL,
    to_date             DATE NOT NULL,
    total_days          INTEGER NOT NULL,
    reason              TEXT NOT NULL,
    handover_note       TEXT,
    alternate_contact   VARCHAR(255),
    supporting_document_url VARCHAR(500),
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected, Cancelled
    approved_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id ON leave_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests (from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (status);

CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Leave balance tracking
CREATE TABLE IF NOT EXISTS leave_balances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type          VARCHAR(50) NOT NULL,
    total_allocated     INTEGER NOT NULL DEFAULT 0,
    used               INTEGER NOT NULL DEFAULT 0,
    carry_forward       INTEGER NOT NULL DEFAULT 0,
    year                INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employee_id, leave_type, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee_id ON leave_balances (employee_id);

CREATE TRIGGER update_leave_balances_updated_at BEFORE UPDATE ON leave_balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
