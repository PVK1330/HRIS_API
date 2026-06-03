-- 099: Global notification deduplication, onboarding handover rules, workflow audit, RBAC permissions

CREATE TABLE IF NOT EXISTS notification_history (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  notification_type VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  recipient_id INTEGER,
  sent_via VARCHAR(32) NOT NULL DEFAULT 'in_app',
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_history_hash_unique UNIQUE (hash)
);

CREATE INDEX IF NOT EXISTS idx_notification_history_entity
  ON notification_history (notification_type, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_notification_history_created
  ON notification_history (created_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_handover_rules (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  workflow_type VARCHAR(64) NOT NULL DEFAULT 'completion',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onboarding_handover_rules_dept_workflow_unique
    UNIQUE (department_id, workflow_type)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_handover_rules_active
  ON onboarding_handover_rules (is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS workflow_audit_logs (
  id SERIAL PRIMARY KEY,
  module VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id INTEGER NOT NULL,
  actor_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  actor_name VARCHAR(255),
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_audit_logs_module_entity
  ON workflow_audit_logs (module, entity_type, entity_id, created_at DESC);

INSERT INTO rbac_permissions (key, label, sort_order) VALUES
  ('onboarding.view', 'Onboarding - View', 130),
  ('onboarding.manage', 'Onboarding - Manage', 131),
  ('assets.create', 'Assets - Create', 221),
  ('assets.edit', 'Assets - Edit', 222),
  ('assets.delete', 'Assets - Delete', 223),
  ('assets.assign', 'Assets - Assign', 224),
  ('assets.return', 'Assets - Return', 225)
ON CONFLICT (key) DO NOTHING;

-- Legacy onboarding → new slugs
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key IN ('onboarding.view', 'onboarding.manage')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'onboarding'
  )
ON CONFLICT DO NOTHING;

-- Legacy onboarding + employee.edit holders get manage
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key = 'onboarding.manage'
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id
      AND p2.key IN ('onboarding', 'employee.edit')
  )
ON CONFLICT DO NOTHING;

-- HR Admin / roles with employee.edit but no onboarding.view
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key = 'onboarding.view'
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'employee.edit'
  )
  AND NOT EXISTS (
    SELECT 1 FROM rbac_role_permissions rp3
    JOIN rbac_permissions p3 ON p3.id = rp3.permission_id
    WHERE rp3.role_id = r.id AND p3.key = 'onboarding.view'
  )
ON CONFLICT DO NOTHING;

-- assets.* from legacy assets key
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key IN ('assets.view', 'assets.create', 'assets.edit', 'assets.delete', 'assets.assign', 'assets.return')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'assets'
  )
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_handover_rules (department_id, workflow_type, is_active)
SELECT d.id, 'completion', true
FROM departments d
WHERE d.manager_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_handover_rules r
    WHERE r.department_id = d.id AND r.workflow_type = 'completion'
  );
