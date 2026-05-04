-- 003_create_attendance_table.sql
-- Daily attendance records

CREATE TABLE IF NOT EXISTS attendance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    check_in_time       TIME,
    check_out_time      TIME,
    work_mode           VARCHAR(50) NOT NULL, -- In Office, Remote, Field
    status              VARCHAR(50) NOT NULL, -- Present, Absent, Half Day, Late, On Leave
    total_hours         DECIMAL(5,2),
    overtime_hours      DECIMAL(5,2) DEFAULT 0,
    is_late             BOOLEAN NOT NULL DEFAULT false,
    early_departure     BOOLEAN NOT NULL DEFAULT false,
    notes               TEXT,
    supporting_document_url VARCHAR(500),
    regularized_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
    regularized_at      TIMESTAMPTZ,
    regularization_status VARCHAR(50) DEFAULT 'N/A', -- N/A, Pending, Approved, Rejected
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (status);

CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
