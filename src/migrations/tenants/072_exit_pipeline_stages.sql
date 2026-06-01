-- Organization exit pipeline stages (progress stepper / tabs)

CREATE TABLE IF NOT EXISTS exit_pipeline_stages (
    id              SERIAL PRIMARY KEY,
    stage_key       VARCHAR(50) NOT NULL UNIQUE,
    label           VARCHAR(100) NOT NULL,
    step_order      INTEGER NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_pipeline_stages_order ON exit_pipeline_stages(step_order);

CREATE TRIGGER update_exit_pipeline_stages_updated_at
    BEFORE UPDATE ON exit_pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Default 6 stages (tenant can customize labels/order in Settings)
INSERT INTO exit_pipeline_stages (stage_key, label, step_order, is_active)
VALUES
    ('submitted', 'Submitted', 1, true),
    ('approved', 'Approved', 2, true),
    ('clearance', 'Clearance', 3, true),
    ('interview', 'Interview', 4, true),
    ('settlement', 'Settlement', 5, true),
    ('exited', 'Exited', 6, true)
ON CONFLICT (stage_key) DO NOTHING;
