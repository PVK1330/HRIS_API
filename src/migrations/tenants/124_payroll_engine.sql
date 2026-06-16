-- 124_payroll_engine.sql
-- Full payroll engine: components, structures, runs, payslips

CREATE TABLE IF NOT EXISTS salary_components (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  component_type VARCHAR(30) NOT NULL CHECK (component_type IN ('earning','deduction','employer_contribution')),
  calculation_type VARCHAR(30) DEFAULT 'fixed' CHECK (calculation_type IN ('fixed','percentage','formula')),
  calculation_basis VARCHAR(100) DEFAULT 'gross',
  default_value DECIMAL(15,4) DEFAULT 0,
  is_taxable BOOLEAN DEFAULT true,
  is_statutory BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_structures (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_structure_components (
  id SERIAL PRIMARY KEY,
  structure_id INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
  value DECIMAL(15,4) DEFAULT 0,
  calculation_type VARCHAR(30) DEFAULT 'fixed',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  UNIQUE (structure_id, component_id)
);

CREATE TABLE IF NOT EXISTS employee_salary_structures (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  structure_id INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  ctc DECIMAL(15,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS pay_periods (
  id SERIAL PRIMARY KEY,
  period_name VARCHAR(100) NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN','PROCESSING','CLOSED','LOCKED')),
  locked_at TIMESTAMPTZ,
  locked_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  pay_period_id INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE RESTRICT,
  run_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PROCESSING','COMPLETED','APPROVED','PAID')),
  total_employees INTEGER DEFAULT 0,
  total_gross DECIMAL(15,2) DEFAULT 0,
  total_deductions DECIMAL(15,2) DEFAULT 0,
  total_net DECIMAL(15,2) DEFAULT 0,
  initiated_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_run_employees (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_days DECIMAL(5,2) DEFAULT 0,
  lop_days DECIMAL(5,2) DEFAULT 0,
  ot_hours DECIMAL(7,2) DEFAULT 0,
  gross_salary DECIMAL(15,2) DEFAULT 0,
  total_earnings DECIMAL(15,2) DEFAULT 0,
  total_deductions DECIMAL(15,2) DEFAULT 0,
  net_salary DECIMAL(15,2) DEFAULT 0,
  earnings JSONB DEFAULT '{}',
  deductions JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_employees_run ON payroll_run_employees (run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_employees_emp ON payroll_run_employees (employee_id);

CREATE TABLE IF NOT EXISTS payslips (
  id SERIAL PRIMARY KEY,
  run_employee_id INTEGER NOT NULL REFERENCES payroll_run_employees(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_period_id INTEGER NOT NULL REFERENCES pay_periods(id),
  payslip_number VARCHAR(50),
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  pdf_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips (employee_id);

CREATE TABLE IF NOT EXISTS lop_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_period_id INTEGER REFERENCES pay_periods(id),
  lop_days DECIMAL(5,2) NOT NULL DEFAULT 0,
  reason VARCHAR(50) DEFAULT 'ABSENT' CHECK (reason IN ('ABSENT','UNAPPROVED_LEAVE','LATE','PENALTY')),
  date_range_start DATE,
  date_range_end DATE,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lop_records_employee ON lop_records (employee_id);

-- Seed default salary components
INSERT INTO salary_components (name, component_type, calculation_type, is_taxable, display_order) VALUES
  ('Basic Salary', 'earning', 'fixed', true, 1),
  ('House Rent Allowance', 'earning', 'percentage', false, 2),
  ('Transport Allowance', 'earning', 'fixed', false, 3),
  ('Medical Allowance', 'earning', 'fixed', false, 4),
  ('Provident Fund', 'deduction', 'percentage', false, 10),
  ('Income Tax (TDS)', 'deduction', 'fixed', false, 11),
  ('Professional Tax', 'deduction', 'fixed', false, 12)
ON CONFLICT DO NOTHING;
