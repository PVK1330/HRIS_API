-- 096: Ensure portal employees can check in/out and view own attendance (RBAC, not role names).

-- Default Employee role gets punch + own view if missing
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'Employee'
  AND p.key IN (
    'attendance.view.own',
    'attendance.create',
    'attendance.regularization.request'
  )
ON CONFLICT DO NOTHING;

-- Portal-enabled employees without a role → assign Employee role
UPDATE employees e
SET rbac_role_id = r.id
FROM rbac_roles r
WHERE r.name = 'Employee'
  AND e.portal_enabled = true
  AND e.deleted_at IS NULL
  AND e.rbac_role_id IS NULL;

-- Re-apply punch bundle for any role that already has legacy attendance / time-tracking
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions legacy ON legacy.id = rp.permission_id
  AND legacy.key IN ('attendance', 'attendance.view', 'time-tracking')
CROSS JOIN rbac_permissions p
WHERE p.key IN (
  'attendance.view.own',
  'attendance.create',
  'attendance.regularization.request'
)
ON CONFLICT DO NOTHING;
