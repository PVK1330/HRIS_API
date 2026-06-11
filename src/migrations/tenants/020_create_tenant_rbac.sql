-- Tenant-scoped RBAC (module keys aligned with hrs frontend Sidebar / PermissionGate)

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id         SERIAL PRIMARY KEY,
    key        VARCHAR(64) NOT NULL,
    label      VARCHAR(128) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_permissions_key ON rbac_permissions (key);

CREATE TABLE IF NOT EXISTS rbac_roles (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    description  TEXT,
    is_system    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_roles_name ON rbac_roles (name);

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    role_id       INTEGER NOT NULL REFERENCES rbac_roles (id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES rbac_permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_permission ON rbac_role_permissions (permission_id);

INSERT INTO rbac_permissions (key, label, sort_order) VALUES
('dashboard', 'Dashboard', 0),
('employee-directory', 'Employee Directory', 10),
('employee-profiles', 'Employee Profiles', 20),
('attendance', 'Attendance', 30),
('leave-absence', 'Leave & Absence', 40),
('documents-approval', 'Documents & Approval', 50),
('visa-nationality', 'Visa & Nationality', 60),
('assets', 'Assets', 70),
('performance', 'Performance', 80),
('training-development', 'Training & Development', 90),
('policies', 'Policies', 100),
('expenses', 'Expenses', 110),
('billing-invoicing', 'Billing & Invoicing', 120),
('onboarding', 'Onboarding', 130),
('exit-management', 'Exit Management', 140),
('letter-templates', 'Letter Templates', 150),
('reports-analytics', 'Reports & Analytics', 160),
('announcements', 'Announcements', 170),
('payroll-management', 'Payroll Management', 180),
('time-tracking', 'Time Tracking', 190),
('shift-management', 'Shift Management', 200),
('overtime-management', 'Overtime Management', 210),
('departments', 'Departments', 220),
('messages', 'Messages', 230),
('system-settings', 'System Settings', 240)
ON CONFLICT (key) DO NOTHING;

INSERT INTO rbac_roles (name, description, is_system)
SELECT 'Organisation Admin', 'Full module access within the tenant. Create custom roles in Settings for restricted portal users.', TRUE
WHERE NOT EXISTS (SELECT 1 FROM rbac_roles WHERE name = 'Organisation Admin');

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r
CROSS JOIN rbac_permissions p
WHERE r.name = 'Organisation Admin'
ON CONFLICT DO NOTHING;
