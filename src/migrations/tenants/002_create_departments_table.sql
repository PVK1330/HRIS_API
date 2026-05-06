-- 002_create_departments_table.sql
-- Departments and organizational structure

CREATE TABLE IF NOT EXISTS departments (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50) UNIQUE NOT NULL,
    description     TEXT,
    parent_id       INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    manager_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    location        VARCHAR(255),
    budget          DECIMAL(15,2),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_code ON departments (code);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments (parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_manager ON departments (manager_id);

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
