-- 025_create_designations_table.sql
-- Designations table linked to departments

CREATE TABLE IF NOT EXISTS designations (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designations_name_department
  ON designations (LOWER(name), department_id);

CREATE INDEX IF NOT EXISTS idx_designations_department ON designations (department_id);
CREATE INDEX IF NOT EXISTS idx_designations_active ON designations (is_active);

CREATE TRIGGER update_designations_updated_at BEFORE UPDATE ON designations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
