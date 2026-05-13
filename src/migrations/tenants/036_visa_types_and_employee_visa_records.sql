-- 036_visa_types_and_employee_visa_records.sql

CREATE TABLE IF NOT EXISTS visa_types (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visa_types_name_lower ON visa_types (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_visa_types_active ON visa_types (is_active);
CREATE INDEX IF NOT EXISTS idx_visa_types_status ON visa_types (status);

CREATE TRIGGER update_visa_types_updated_at
  BEFORE UPDATE ON visa_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO visa_types (name, is_active, status)
SELECT v.name, true, 'active' FROM (VALUES
  ('Employment'),
  ('Residence'),
  ('Visit'),
  ('Investor'),
  ('Student'),
  ('Dependent')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM visa_types t WHERE LOWER(t.name) = LOWER(v.name));

CREATE TABLE IF NOT EXISTS employee_visa_records (
  id                     SERIAL PRIMARY KEY,
  employee_id            INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  emp_id                 VARCHAR(50),
  nationality            VARCHAR(100) NOT NULL,
  passport_number        VARCHAR(50) NOT NULL,
  passport_issue_date    DATE NOT NULL,
  passport_expiry_date   DATE NOT NULL,
  country_of_issue       VARCHAR(100) NOT NULL,
  visa_type_id           INTEGER REFERENCES visa_types(id) ON DELETE SET NULL,
  visa_type_name         VARCHAR(100),
  visa_number            VARCHAR(80) NOT NULL,
  visa_issue_date        DATE NOT NULL,
  visa_expiry_date       DATE NOT NULL,
  issued_by              VARCHAR(150),
  sponsoring_entity      VARCHAR(200),
  emirates_id_number     VARCHAR(50),
  emirates_id_expiry     DATE,
  passport_scan_url      VARCHAR(500),
  visa_copy_url          VARCHAR(500),
  emirates_id_front_url  VARCHAR(500),
  emirates_id_back_url   VARCHAR(500),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_by             INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_visa_records_employee_id ON employee_visa_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_visa_records_visa_expiry ON employee_visa_records (visa_expiry_date);
CREATE INDEX IF NOT EXISTS idx_employee_visa_records_passport_expiry ON employee_visa_records (passport_expiry_date);
CREATE INDEX IF NOT EXISTS idx_employee_visa_records_is_active ON employee_visa_records (is_active);

CREATE TRIGGER update_employee_visa_records_updated_at
  BEFORE UPDATE ON employee_visa_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS visa_alert_logs (
  id               SERIAL PRIMARY KEY,
  employee_id      INTEGER,
  visa_record_id   INTEGER REFERENCES employee_visa_records(id) ON DELETE SET NULL,
  alert_type       VARCHAR(32) NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_remaining   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_visa_alert_logs_sent_at ON visa_alert_logs (sent_at);
