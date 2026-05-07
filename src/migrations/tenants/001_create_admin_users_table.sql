CREATE TABLE IF NOT EXISTS admin_users (
    id            SERIAL PRIMARY KEY,
    tenant_id     INTEGER NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    status        VARCHAR(32)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email     ON admin_users (email);
CREATE INDEX IF NOT EXISTS idx_admin_users_tenant_id ON admin_users (tenant_id);
