-- 123_leave_encashment_accrual.sql
-- Leave encashment requests + accrual ledger + email settings

CREATE TABLE IF NOT EXISTS leave_encashment_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(100) NOT NULL,
  days_requested DECIMAL(5,2) NOT NULL,
  amount_per_day DECIMAL(15,2),
  total_amount DECIMAL(15,2),
  status VARCHAR(30) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Paid')),
  approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  payment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_encashment_employee ON leave_encashment_requests (employee_id);

CREATE TABLE IF NOT EXISTS leave_accrual_ledger (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(100) NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  days_accrued DECIMAL(5,2) NOT NULL DEFAULT 0,
  running_balance DECIMAL(7,2) NOT NULL DEFAULT 0,
  accrual_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, leave_type, year, month)
);

CREATE INDEX IF NOT EXISTS idx_leave_accrual_employee ON leave_accrual_ledger (employee_id, leave_type, year);

-- Email settings columns on tenant_admin_settings
ALTER TABLE tenant_admin_settings
  ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255),
  ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_username VARCHAR(255),
  ADD COLUMN IF NOT EXISTS smtp_password_enc TEXT,
  ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255) DEFAULT 'HRMS',
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT false;
