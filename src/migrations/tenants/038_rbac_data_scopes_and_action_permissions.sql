-- 038_rbac_data_scopes_and_action_permissions.sql
-- Data scope per role + enterprise action slugs (alongside legacy module keys)

CREATE TABLE IF NOT EXISTS role_data_scopes (
  role_id INTEGER PRIMARY KEY REFERENCES rbac_roles (id) ON DELETE CASCADE,
  scope   VARCHAR(20) NOT NULL DEFAULT 'SELF'
    CHECK (scope IN ('SELF', 'TEAM', 'DEPARTMENT', 'ALL'))
);

-- Action-based permissions (module.action)
INSERT INTO rbac_permissions (key, label, sort_order) VALUES
('employee.view', 'Employee — View', 11),
('employee.create', 'Employee — Create', 12),
('employee.edit', 'Employee — Edit', 13),
('employee.delete', 'Employee — Delete', 14),
('leave.view', 'Leave — View', 41),
('leave.apply', 'Leave — Apply', 42),
('leave.approve', 'Leave — Approve', 43),
('document.view', 'Document — View', 51),
('document.upload', 'Document — Upload', 52),
('payroll.view', 'Payroll — View', 181),
('attendance.view', 'Attendance — View', 31),
('performance.view', 'Performance — View', 81),
('departments.manage', 'Departments — Manage', 221),
('policies.manage', 'Policies — Manage', 101),
('visa.view', 'Visa — View', 61),
('visa.manage', 'Visa — Manage', 62),
('messages.view', 'Messages — View', 231),
('assets.view', 'Assets — View', 71)
ON CONFLICT (key) DO NOTHING;

-- Organisation Admin: ALL scope + all action permissions
INSERT INTO role_data_scopes (role_id, scope)
SELECT id, 'ALL' FROM rbac_roles WHERE name = 'Organisation Admin'
ON CONFLICT (role_id) DO UPDATE SET scope = EXCLUDED.scope;

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'Organisation Admin'
  AND p.key LIKE '%.%'
ON CONFLICT DO NOTHING;

-- Default data scope for non–org-admin roles (customize per role in Settings)
INSERT INTO role_data_scopes (role_id, scope)
SELECT id, 'SELF' FROM rbac_roles WHERE name <> 'Organisation Admin'
ON CONFLICT (role_id) DO NOTHING;

-- Backfill action slugs from legacy module keys already assigned to roles
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, action_p.id
FROM rbac_role_permissions rp
JOIN rbac_permissions legacy_p ON legacy_p.id = rp.permission_id
JOIN rbac_permissions action_p ON action_p.key = CASE legacy_p.key
  WHEN 'employee-directory' THEN 'employee.view'
  WHEN 'employee-profiles' THEN 'employee.view'
  WHEN 'attendance' THEN 'attendance.view'
  WHEN 'leave-absence' THEN 'leave.view'
  WHEN 'documents-approval' THEN 'document.view'
  WHEN 'visa-nationality' THEN 'visa.view'
  WHEN 'assets' THEN 'assets.view'
  WHEN 'performance' THEN 'performance.view'
  WHEN 'policies' THEN 'policies.manage'
  WHEN 'payroll-management' THEN 'payroll.view'
  WHEN 'departments' THEN 'departments.manage'
  WHEN 'messages' THEN 'messages.view'
  WHEN 'letter-templates' THEN 'letter-templates'
  ELSE NULL
END
WHERE action_p.key IS NOT NULL
ON CONFLICT DO NOTHING;
