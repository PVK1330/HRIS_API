-- 010_create_policies_table.sql
-- Policy management and acknowledgements

CREATE TABLE IF NOT EXISTS policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_title        VARCHAR(255) NOT NULL,
    policy_category     VARCHAR(100), -- HR, IT, Finance, Compliance, etc.
    policy_code         VARCHAR(50) UNIQUE NOT NULL,
    effective_date      DATE NOT NULL,
    review_date         DATE,
    applicable_to       VARCHAR(50) NOT NULL, -- All, Department, Role
    department          VARCHAR(255),
    role                VARCHAR(100),
    version             VARCHAR(20) NOT NULL DEFAULT '1.0',
    summary             TEXT,
    file_url            VARCHAR(500) NOT NULL,
    file_name           VARCHAR(255) NOT NULL,
    status              VARCHAR(50) NOT NULL DEFAULT 'Draft', -- Draft, Review, Published, Archived
    owner_id            UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_code ON policies (policy_code);
CREATE INDEX IF NOT EXISTS idx_policies_category ON policies (policy_category);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies (status);

CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Policy acknowledgements
CREATE TABLE IF NOT EXISTS policy_acknowledgements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id           UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    acknowledged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address          VARCHAR(50),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(policy_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acknowledgements_policy_id ON policy_acknowledgements (policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_acknowledgements_employee_id ON policy_acknowledgements (employee_id);
