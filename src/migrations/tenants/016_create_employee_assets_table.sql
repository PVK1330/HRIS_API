-- 016_create_employee_assets_table.sql
-- Employee asset assignments

CREATE TABLE IF NOT EXISTS employee_assets (
    id                  SERIAL PRIMARY KEY,
    employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    asset_tag           VARCHAR(100) NOT NULL,
    asset_name          VARCHAR(255) NOT NULL,
    category            VARCHAR(100) NOT NULL,
    serial_number       VARCHAR(100),
    condition           VARCHAR(50) NOT NULL DEFAULT 'Good', -- Excellent, Good, Fair, Poor
    status              VARCHAR(50) NOT NULL DEFAULT 'Issued', -- Issued, Returned, Lost, Damaged
    assigned_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    returned_date       DATE,
    notes               TEXT,
    assigned_by         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_assets_employee_id ON employee_assets (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_assets_status ON employee_assets (status);

CREATE TRIGGER update_employee_assets_updated_at
    BEFORE UPDATE ON employee_assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
