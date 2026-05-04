-- 001_create_employees_table.sql
-- Core employee table (tenant-specific schema)
-- This runs in each tenant's schema

CREATE TABLE IF NOT EXISTS employees (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emp_id              VARCHAR(20) UNIQUE NOT NULL,
    full_name           VARCHAR(255) NOT NULL,
    first_name          VARCHAR(100),
    last_name           VARCHAR(100),
    date_of_birth       DATE,
    gender              VARCHAR(20),
    nationality         VARCHAR(100),
    personal_email      VARCHAR(255),
    phone_number        VARCHAR(50),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    home_address        TEXT,
    
    -- Employment Details
    job_title           VARCHAR(255) NOT NULL,
    department          VARCHAR(255) NOT NULL,
    employment_type     VARCHAR(50) NOT NULL, -- Full-time, Part-time, Contract
    work_location       VARCHAR(255),
    reporting_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    join_date           DATE NOT NULL,
    probation_end_date  DATE,
    work_email          VARCHAR(255) UNIQUE,
    salary              DECIMAL(12,2),
    employment_status   VARCHAR(50) NOT NULL DEFAULT 'Active', -- Active, Probation, Notice Period, On Leave, Terminated
    
    -- Identity & Visa
    passport_number     VARCHAR(100),
    passport_expiry     DATE,
    emirates_id_number  VARCHAR(50),
    emirates_id_expiry  DATE,
    visa_type           VARCHAR(50),
    visa_expiry_date    DATE,
    
    -- Profile
    profile_image_url   VARCHAR(500),
    bio                 TEXT,
    
    -- Audit
    created_by          UUID,
    updated_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employees_emp_id ON employees (emp_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees (department);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees (reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees (deleted_at);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
