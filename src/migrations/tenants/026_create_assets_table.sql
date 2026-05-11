-- 026_create_assets_table.sql

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_id VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(100) NOT NULL,
  serial_number VARCHAR(100) NOT NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  condition VARCHAR(50) DEFAULT 'Good',
  status VARCHAR(50) DEFAULT 'Available',
  issue_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_employee_id ON assets(employee_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
