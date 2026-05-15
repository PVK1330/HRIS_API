-- Migration: Create Payroll Tables
-- Path: d:\HRIS_API\src\migrations\tenants\038_create_payroll_tables.sql

CREATE TABLE IF NOT EXISTS payroll_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('addition', 'overtime', 'deduction')),
    category VARCHAR(255),
    amount DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_salaries (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    net_salary DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    earnings JSONB DEFAULT '{}',
    deductions JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_payroll_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_payroll_items_timestamp BEFORE UPDATE ON payroll_items FOR EACH ROW EXECUTE PROCEDURE update_payroll_timestamp();
CREATE TRIGGER update_employee_salaries_timestamp BEFORE UPDATE ON employee_salaries FOR EACH ROW EXECUTE PROCEDURE update_payroll_timestamp();
