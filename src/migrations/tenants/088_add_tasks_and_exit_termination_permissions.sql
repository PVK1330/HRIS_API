-- 088_add_tasks_and_exit_termination_permissions.sql
-- Adds explicit permissions for Tasks module access and Termination submission.

INSERT INTO rbac_permissions (key, label, sort_order)
VALUES ('tasks', 'Tasks - Manage', 240)
ON CONFLICT (key) DO NOTHING;

INSERT INTO rbac_permissions (key, label, sort_order)
VALUES ('exit.terminate', 'Exit - Submit Termination', 245)
ON CONFLICT (key) DO NOTHING;
