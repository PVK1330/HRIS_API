-- ============================================================================
-- Migration: Performance Management granular RBAC permissions
-- Description: Adds granular performance.* permission slugs and grants them to
--              existing roles based on their data scope so current access is
--              preserved while routes become permission-gated.
-- ============================================================================

INSERT INTO rbac_permissions (key, label, sort_order) VALUES
  ('performance.view.own',  'Performance - View Own',        82),
  ('performance.view.team', 'Performance - View Team',       83),
  ('performance.review',    'Performance - Review / Goals',  84),
  ('performance.manage',    'Performance - Manage',          85),
  ('performance.approve',   'Performance - Approve',         86)
ON CONFLICT (key) DO NOTHING;

-- ── Grant to roles that already had the legacy `performance` module ──────────
-- Scope ALL (Org Admin / HR): full performance control
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
JOIN role_data_scopes ds ON ds.role_id = r.id AND ds.scope = 'ALL'
CROSS JOIN rbac_permissions p
WHERE p.key IN ('performance.view', 'performance.view.own', 'performance.view.team',
                'performance.review', 'performance.manage', 'performance.approve')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'performance'
  )
ON CONFLICT DO NOTHING;

-- Scope TEAM / DEPARTMENT (Managers): view + set goals for their team
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
JOIN role_data_scopes ds ON ds.role_id = r.id AND ds.scope IN ('TEAM', 'DEPARTMENT')
CROSS JOIN rbac_permissions p
WHERE p.key IN ('performance.view', 'performance.view.own', 'performance.view.team',
                'performance.review')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'performance'
  )
ON CONFLICT DO NOTHING;

-- Scope SELF (Employees): view + update own progress
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
JOIN role_data_scopes ds ON ds.role_id = r.id AND ds.scope = 'SELF'
CROSS JOIN rbac_permissions p
WHERE p.key IN ('performance.view', 'performance.view.own')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'performance'
  )
ON CONFLICT DO NOTHING;
