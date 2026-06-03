-- 091_attendance_permissions.sql
-- Granular attendance RBAC permissions

INSERT INTO rbac_permissions (key, label, sort_order) VALUES
  ('attendance.view.own', 'Attendance - View Own', 150),
  ('attendance.view.team', 'Attendance - View Team', 151),
  ('attendance.view.all', 'Attendance - View All', 152),
  ('attendance.create', 'Attendance - Create / Check-in', 153),
  ('attendance.update', 'Attendance - Update', 154),
  ('attendance.regularization.request', 'Attendance - Request Regularization', 155),
  ('attendance.approve', 'Attendance - Approve', 156),
  ('attendance.reject', 'Attendance - Reject', 157),
  ('attendance.manage', 'Attendance - Manage / Override', 158),
  ('attendance.settings.view', 'Attendance Settings - View', 159),
  ('attendance.settings.manage', 'Attendance Settings - Manage', 160)
ON CONFLICT (key) DO NOTHING;

-- Legacy attendance module → view all + manage for existing roles that had attendance
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE p.key IN ('attendance.view.all', 'attendance.manage')
  AND EXISTS (
    SELECT 1 FROM rbac_role_permissions rp2
    JOIN rbac_permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.key = 'attendance'
  )
ON CONFLICT DO NOTHING;
