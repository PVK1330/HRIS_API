-- 122_approval_workflow_engine.sql
-- Generic approval workflow engine (mirrors exit_workflow pattern)

CREATE TABLE IF NOT EXISTS approval_workflows (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  module VARCHAR(50) NOT NULL CHECK (module IN ('leave','overtime','regularization','expense','shift_change')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_workflow_stages (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL,
  stage_name VARCHAR(255) NOT NULL,
  approver_type VARCHAR(50) NOT NULL DEFAULT 'REPORTING_MANAGER'
    CHECK (approver_type IN ('REPORTING_MANAGER','DEPARTMENT_HEAD','HR','SPECIFIC_ROLE','SPECIFIC_EMPLOYEE')),
  approver_role_id INTEGER REFERENCES rbac_roles(id) ON DELETE SET NULL,
  approver_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  mode VARCHAR(20) DEFAULT 'SEQUENTIAL' CHECK (mode IN ('ANY','ALL','SEQUENTIAL')),
  sla_hours INTEGER DEFAULT 48,
  escalation_hours INTEGER DEFAULT 72,
  is_optional BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workflow_id, stage_order)
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER REFERENCES approval_workflows(id) ON DELETE SET NULL,
  module VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  current_stage INTEGER DEFAULT 1,
  total_stages INTEGER DEFAULT 1,
  status VARCHAR(50) DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','WITHDRAWN','ESCALATED')),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_employee ON approval_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests (status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_approval_requests_entity ON approval_requests (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS approval_actions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES approval_workflow_stages(id) ON DELETE SET NULL,
  stage_order INTEGER,
  actor_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('APPROVED','REJECTED','ESCALATED','DELEGATED','WITHDRAWN','COMMENTED')),
  remarks TEXT,
  acted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_actions_request ON approval_actions (request_id);

CREATE TABLE IF NOT EXISTS approval_delegations (
  id SERIAL PRIMARY KEY,
  delegator_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delegate_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  module VARCHAR(50),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_delegation_dates CHECK (to_date >= from_date)
);
