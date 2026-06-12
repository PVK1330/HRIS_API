-- 094_attendance_role_permissions.sql
-- Assign granular attendance permissions to roles (fixes "Missing attendance.manage")

-- Organisation Admin: all attendance.* slugs
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'Organisation Admin'
  AND p.key LIKE 'attendance.%'
ON CONFLICT DO NOTHING;

-- Roles with legacy module "attendance" → HR / admin attendance bundle
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions legacy ON legacy.id = rp.permission_id AND legacy.key = 'attendance'
CROSS JOIN rbac_permissions p
WHERE p.key IN (
  'attendance.view.own',
  'attendance.view.team',
  'attendance.view.all',
  'attendance.create',
  'attendance.update',
  'attendance.regularization.request',
  'attendance.approve',
  'attendance.reject',
  'attendance.manage',
  'attendance.settings.view',
  'attendance.settings.manage'
)
ON CONFLICT DO NOTHING;

-- HR Admin role by name (even if only attendance.view was assigned)
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name IN ('HR Admin', 'HR Executive', 'HR Manager')
  AND p.key IN (
    'attendance.view.own',
    'attendance.view.team',
    'attendance.view.all',
    'attendance.create',
    'attendance.update',
    'attendance.regularization.request',
    'attendance.approve',
    'attendance.reject',
    'attendance.manage',
    'attendance.settings.view',
    'attendance.settings.manage'
  )
ON CONFLICT DO NOTHING;

-- Department / manager roles: team lead bundle
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
LEFT JOIN role_data_scopes rds ON rds.role_id = r.id
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions legacy ON legacy.id = rp.permission_id
  AND legacy.key IN ('attendance', 'attendance.view', 'time-tracking', 'shift-management', 'overtime-management')
CROSS JOIN rbac_permissions p
WHERE p.key IN (
  'attendance.view.own',
  'attendance.view.team',
  'attendance.create',
  'attendance.update',
  'attendance.regularization.request',
  'attendance.approve',
  'attendance.reject'
)
  AND (
    r.name ILIKE '%Head%'
    OR r.name ILIKE '%Manager%'
    OR r.name ILIKE '%Lead%'
    OR rds.scope IN ('DEPARTMENT', 'TEAM', 'ALL')
  )
  AND r.name NOT IN ('HR Admin', 'HR Executive', 'HR Manager', 'Organisation Admin')
ON CONFLICT DO NOTHING;

-- Employee / self scope: punch + own view + regularization
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
LEFT JOIN role_data_scopes rds ON rds.role_id = r.id
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions legacy ON legacy.id = rp.permission_id
  AND legacy.key IN ('attendance.view', 'time-tracking', 'attendance')
CROSS JOIN rbac_permissions p
WHERE p.key IN (
  'attendance.view.own',
  'attendance.create',
  'attendance.regularization.request'
)
  AND (
    r.name = 'Employee'
    OR rds.scope = 'SELF'
  )
  AND NOT EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'attendance.manage'
  )
ON CONFLICT DO NOTHING;

-- Legacy attendance.view only (no granular yet) → at least view.own + create
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions legacy ON legacy.id = rp.permission_id AND legacy.key = 'attendance.view'
CROSS JOIN rbac_permissions p
WHERE p.key IN ('attendance.view.own', 'attendance.create', 'attendance.regularization.request')
  AND NOT EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'attendance.view.all'
  )
ON CONFLICT DO NOTHING;
