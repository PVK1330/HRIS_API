-- 060_exit_management_v2.sql
-- Extended exit management: termination types, clearance tasks, exit documents

-- Termination types settings table
CREATE TABLE IF NOT EXISTS termination_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_termination_types_updated_at BEFORE UPDATE ON termination_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default termination types
INSERT INTO termination_types (name, description, sort_order) VALUES
  ('Voluntary Resignation', 'Employee-initiated departure', 1),
  ('Involuntary Termination', 'Employer-initiated termination for cause', 2),
  ('Redundancy / Layoff', 'Position elimination or workforce reduction', 3),
  ('Contract End', 'Fixed-term contract expiration', 4),
  ('Retirement', 'Employee retirement', 5),
  ('Mutual Agreement', 'Separation by mutual consent', 6)
ON CONFLICT DO NOTHING;

-- Add columns to exit_records if missing
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS termination_type_id INTEGER REFERENCES termination_types(id) ON DELETE SET NULL;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS notice_date DATE;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS resignation_date DATE;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Clearance tasks table (flexible, department-based)
CREATE TABLE IF NOT EXISTS clearance_tasks (
    id SERIAL PRIMARY KEY,
    exit_record_id INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    department VARCHAR(100) NOT NULL,
    task_name VARCHAR(255) NOT NULL,
    assigned_to INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    completed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clearance_tasks_exit ON clearance_tasks (exit_record_id);

CREATE TRIGGER update_clearance_tasks_updated_at BEFORE UPDATE ON clearance_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Exit documents table
CREATE TABLE IF NOT EXISTS exit_documents (
    id SERIAL PRIMARY KEY,
    exit_record_id INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    document_title VARCHAR(255) NOT NULL,
    file_url VARCHAR(500),
    file_name VARCHAR(255),
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_documents_exit ON exit_documents (exit_record_id);

-- Update asset_returns to also add updated_at
ALTER TABLE asset_returns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
