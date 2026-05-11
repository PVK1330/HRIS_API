ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS rbac_role_id INTEGER REFERENCES rbac_roles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_employees_rbac_role_id ON employees (rbac_role_id);
CREATE INDEX IF NOT EXISTS idx_employees_portal ON employees (portal_enabled) WHERE portal_enabled = TRUE;
