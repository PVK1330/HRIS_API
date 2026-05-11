-- 031_create_policies_table.sql
DROP TABLE IF EXISTS policy_acknowledgements CASCADE;
DROP TABLE IF EXISTS policies CASCADE;

CREATE TABLE policies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  version VARCHAR(20) DEFAULT '1.0',
  description TEXT,
  effective_date DATE,
  review_date DATE,
  ack_required BOOLEAN DEFAULT TRUE,
  audience VARCHAR(50) DEFAULT 'All Employees',
  status VARCHAR(20) DEFAULT 'Draft',
  content JSONB,
  file_url TEXT,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER REFERENCES policies(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'Acknowledged',
  UNIQUE(policy_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policies_category_v2 ON policies(category);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policy_acks_policy_id ON policy_acknowledgements(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_acks_employee_id ON policy_acknowledgements(employee_id);
