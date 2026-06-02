-- 087_add_tasks_permission.sql
-- Add the Tasks module permission and assign it to all existing roles by default

INSERT INTO rbac_permissions (key, label, sort_order) 
VALUES ('tasks', 'Tasks — Manage', 240)
ON CONFLICT (key) DO NOTHING;

-- By default, assign it to all existing roles
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key = 'tasks'
ON CONFLICT DO NOTHING;
