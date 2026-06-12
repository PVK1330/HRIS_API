-- Employee portal: view and acknowledge policies (separate from manage)

INSERT INTO rbac_permissions (key, label, sort_order) VALUES
('policies.view', 'Policies — View', 102),
('policies.acknowledge', 'Policies — Acknowledge', 103)
ON CONFLICT (key) DO NOTHING;

-- Roles with legacy "policies" module also get view + acknowledge (not full manage unless already assigned)
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, action_p.id
FROM rbac_role_permissions rp
JOIN rbac_permissions legacy_p ON legacy_p.id = rp.permission_id
JOIN rbac_permissions action_p ON action_p.key IN ('policies.view', 'policies.acknowledge')
WHERE legacy_p.key = 'policies'
ON CONFLICT DO NOTHING;

-- Organisation Admin: all policy actions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'Organisation Admin'
  AND p.key IN ('policies.view', 'policies.acknowledge', 'policies.manage')
ON CONFLICT DO NOTHING;
