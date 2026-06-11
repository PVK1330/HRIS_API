-- 103_seed_common_org_defaults.sql
-- Seeds a common, industry-agnostic set of Departments, Designations and Roles
-- for every tenant so a new organization starts with sensible defaults instead
-- of a blank slate. Fully idempotent: only inserts entries that don't already
-- exist (by code/name), so existing/customized tenants are never duplicated and
-- nothing they created is overwritten.

-- ---------------------------------------------------------------------------
-- 1) Common departments (skipped if a same code OR same name already exists)
-- ---------------------------------------------------------------------------
INSERT INTO departments (name, code, description)
SELECT v.name, v.code, v.description
FROM (VALUES
  ('Executive / Leadership', 'EXE',  'Executive leadership and company strategy'),
  ('Human Resources',        'HR',   'Recruitment, employee relations and HR operations'),
  ('Finance & Accounts',     'FIN',  'Accounting, payroll, budgeting and financial reporting'),
  ('Information Technology',  'IT',   'IT infrastructure, systems and technical support'),
  ('Administration',         'ADM',  'Office administration and facilities management'),
  ('Operations',             'OPS',  'Day-to-day business operations'),
  ('Sales',                  'SAL',  'Sales and business development'),
  ('Marketing',              'MKT',  'Marketing, branding and communications'),
  ('Customer Support',       'CS',   'Customer service and support'),
  ('Legal & Compliance',     'LEG',  'Legal affairs, contracts and compliance'),
  ('Procurement',            'PROC', 'Purchasing, vendor and supply-chain management')
) AS v(name, code, description)
WHERE NOT EXISTS (
  SELECT 1 FROM departments d
  WHERE d.code = v.code OR LOWER(d.name) = LOWER(v.name)
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Common designations, attached to the departments above (by code).
--    The unique (LOWER(name), department_id) index makes this idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO designations (name, department_id)
SELECT v.name, d.id
FROM (VALUES
  -- Executive / Leadership
  ('EXE',  'Chief Executive Officer'),
  ('EXE',  'Chief Operating Officer'),
  ('EXE',  'Managing Director'),
  ('EXE',  'General Manager'),
  -- Human Resources
  ('HR',   'HR Manager'),
  ('HR',   'HR Executive'),
  ('HR',   'HR Officer'),
  ('HR',   'Recruiter'),
  -- Finance & Accounts
  ('FIN',  'Finance Manager'),
  ('FIN',  'Accountant'),
  ('FIN',  'Accounts Executive'),
  ('FIN',  'Financial Analyst'),
  -- Information Technology
  ('IT',   'IT Manager'),
  ('IT',   'Software Engineer'),
  ('IT',   'System Administrator'),
  ('IT',   'IT Support Engineer'),
  -- Administration
  ('ADM',  'Admin Manager'),
  ('ADM',  'Administrative Officer'),
  ('ADM',  'Office Assistant'),
  ('ADM',  'Receptionist'),
  -- Operations
  ('OPS',  'Operations Manager'),
  ('OPS',  'Operations Executive'),
  ('OPS',  'Team Lead'),
  ('OPS',  'Coordinator'),
  -- Sales
  ('SAL',  'Sales Manager'),
  ('SAL',  'Sales Executive'),
  ('SAL',  'Business Development Manager'),
  ('SAL',  'Account Manager'),
  -- Marketing
  ('MKT',  'Marketing Manager'),
  ('MKT',  'Marketing Executive'),
  ('MKT',  'Digital Marketing Specialist'),
  ('MKT',  'Content Writer'),
  -- Customer Support
  ('CS',   'Customer Support Manager'),
  ('CS',   'Customer Support Executive'),
  ('CS',   'Support Agent'),
  -- Legal & Compliance
  ('LEG',  'Legal Manager'),
  ('LEG',  'Legal Counsel'),
  ('LEG',  'Compliance Officer'),
  -- Procurement
  ('PROC', 'Procurement Manager'),
  ('PROC', 'Procurement Officer'),
  ('PROC', 'Purchase Executive')
) AS v(dept_code, name)
JOIN departments d ON d.code = v.dept_code
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Common roles (templates the admin can edit/extend). is_system = FALSE so
--    they remain editable; "Organisation Admin" (full access) is seeded in 020.
-- ---------------------------------------------------------------------------
INSERT INTO rbac_roles (name, description, is_system)
SELECT v.name, v.description, FALSE
FROM (VALUES
  ('HR Manager',         'Manages people operations: employees, attendance, leave, onboarding/exit, documents and policies.'),
  ('Finance Manager',    'Manages payroll, expenses, billing/invoicing and financial reports.'),
  ('Department Manager', 'Oversees a department: team directory, attendance, leave approvals, performance and reports.'),
  ('Team Lead',          'Leads a team: directory, attendance, leave and performance for their team.'),
  ('Employee',           'Self-service access: attendance, leave, documents, policies and announcements.')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM rbac_roles r WHERE r.name = v.name)
ON CONFLICT (name) DO NOTHING;

-- Grant module permissions to the seeded roles (keys defined in migration 020).
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  -- HR Manager
  ('HR Manager', 'dashboard'),
  ('HR Manager', 'employee-directory'),
  ('HR Manager', 'employee-profiles'),
  ('HR Manager', 'attendance'),
  ('HR Manager', 'leave-absence'),
  ('HR Manager', 'documents-approval'),
  ('HR Manager', 'visa-nationality'),
  ('HR Manager', 'onboarding'),
  ('HR Manager', 'exit-management'),
  ('HR Manager', 'letter-templates'),
  ('HR Manager', 'policies'),
  ('HR Manager', 'performance'),
  ('HR Manager', 'training-development'),
  ('HR Manager', 'departments'),
  ('HR Manager', 'reports-analytics'),
  ('HR Manager', 'announcements'),
  ('HR Manager', 'messages'),
  -- Finance Manager
  ('Finance Manager', 'dashboard'),
  ('Finance Manager', 'payroll-management'),
  ('Finance Manager', 'expenses'),
  ('Finance Manager', 'billing-invoicing'),
  ('Finance Manager', 'reports-analytics'),
  ('Finance Manager', 'employee-directory'),
  ('Finance Manager', 'announcements'),
  ('Finance Manager', 'messages'),
  -- Department Manager
  ('Department Manager', 'dashboard'),
  ('Department Manager', 'employee-directory'),
  ('Department Manager', 'employee-profiles'),
  ('Department Manager', 'attendance'),
  ('Department Manager', 'leave-absence'),
  ('Department Manager', 'performance'),
  ('Department Manager', 'documents-approval'),
  ('Department Manager', 'departments'),
  ('Department Manager', 'reports-analytics'),
  ('Department Manager', 'announcements'),
  ('Department Manager', 'messages'),
  -- Team Lead
  ('Team Lead', 'dashboard'),
  ('Team Lead', 'employee-directory'),
  ('Team Lead', 'attendance'),
  ('Team Lead', 'leave-absence'),
  ('Team Lead', 'performance'),
  ('Team Lead', 'announcements'),
  ('Team Lead', 'messages'),
  -- Employee (self-service)
  ('Employee', 'dashboard'),
  ('Employee', 'attendance'),
  ('Employee', 'leave-absence'),
  ('Employee', 'documents-approval'),
  ('Employee', 'policies'),
  ('Employee', 'announcements'),
  ('Employee', 'messages')
) AS g(role_name, perm_key)
JOIN rbac_roles r ON r.name = g.role_name
JOIN rbac_permissions p ON p.key = g.perm_key
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Mirror the same role names into the legacy `roles` name-list, which a few
--    features (leave settings, sensitive-data access) read from. Keeps the
--    available roles consistent everywhere. Permissions default to '{}'.
-- ---------------------------------------------------------------------------
INSERT INTO roles (name)
SELECT v.name
FROM (VALUES
  ('HR Manager'),
  ('Finance Manager'),
  ('Department Manager'),
  ('Team Lead'),
  ('Employee')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE LOWER(r.name) = LOWER(v.name))
ON CONFLICT DO NOTHING;
