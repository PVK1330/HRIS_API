-- 125_centralized_audit_log.sql
-- Tenant-level centralized audit log

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  actor_user_id INTEGER,
  actor_name VARCHAR(255),
  actor_role VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  module VARCHAR(80) NOT NULL,
  entity_type VARCHAR(100),
  entity_id INTEGER,
  old_value JSONB,
  new_value JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','FAILURE','WARNING')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs (module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
