-- 126_shift_change_requests.sql
-- Employee shift change requests

CREATE TABLE IF NOT EXISTS shift_change_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  current_shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  requested_shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(30) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_change_employee ON shift_change_requests (employee_id);
