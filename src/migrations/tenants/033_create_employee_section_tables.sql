-- 033_create_employee_section_tables.sql
-- Normalized employee section tables for profile payload integration

CREATE TABLE IF NOT EXISTS employee_documents (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type     VARCHAR(100),
  document_name     VARCHAR(255),
  document_number   VARCHAR(150),
  issued_date       DATE,
  expiry_date       DATE,
  file_url          TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);

CREATE TABLE IF NOT EXISTS employee_bank_details (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  bank_name         VARCHAR(255),
  account_holder    VARCHAR(255),
  account_number    VARCHAR(120),
  ifsc_code         VARCHAR(50),
  swift_code        VARCHAR(50),
  iban              VARCHAR(80),
  branch_name       VARCHAR(255),
  branch_address    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_addresses (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  address_type      VARCHAR(50) NOT NULL DEFAULT 'home',
  line1             TEXT,
  line2             TEXT,
  city              VARCHAR(120),
  state             VARCHAR(120),
  country           VARCHAR(120),
  postal_code       VARCHAR(30),
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_addresses_employee_id ON employee_addresses(employee_id);

CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contact_name      VARCHAR(255),
  relationship      VARCHAR(120),
  phone_primary     VARCHAR(60),
  phone_secondary   VARCHAR(60),
  email             VARCHAR(255),
  address           TEXT,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_emergency_contacts_employee_id ON employee_emergency_contacts(employee_id);

CREATE TABLE IF NOT EXISTS employee_experience (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_name      VARCHAR(255),
  designation       VARCHAR(255),
  start_date        DATE,
  end_date          DATE,
  is_current        BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_experience_employee_id ON employee_experience(employee_id);

CREATE TABLE IF NOT EXISTS employee_education (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  institution_name  VARCHAR(255),
  course_name       VARCHAR(255),
  specialization    VARCHAR(255),
  start_date        DATE,
  end_date          DATE,
  grade             VARCHAR(80),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_education_employee_id ON employee_education(employee_id);

CREATE TABLE IF NOT EXISTS employee_salary (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  currency          VARCHAR(10) DEFAULT 'AED',
  basic_salary      NUMERIC(12,2),
  allowances        NUMERIC(12,2),
  deductions        NUMERIC(12,2),
  net_salary        NUMERIC(12,2),
  payment_frequency VARCHAR(30),
  effective_from    DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date   DATE NOT NULL,
  check_in_time     TIME,
  check_out_time    TIME,
  total_hours       NUMERIC(6,2),
  status            VARCHAR(40),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_employee_id ON employee_attendance(employee_id);
