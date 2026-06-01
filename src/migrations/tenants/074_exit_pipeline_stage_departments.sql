-- Multiple departments per exit pipeline stage (Settings)

CREATE TABLE IF NOT EXISTS exit_pipeline_stage_departments (
    id              SERIAL PRIMARY KEY,
    stage_key       VARCHAR(50) NOT NULL REFERENCES exit_pipeline_stages(stage_key) ON DELETE CASCADE,
    department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage_key, department_id)
);

CREATE INDEX IF NOT EXISTS idx_exit_pipeline_stage_depts_stage
    ON exit_pipeline_stage_departments(stage_key);

CREATE INDEX IF NOT EXISTS idx_exit_pipeline_stage_depts_department
    ON exit_pipeline_stage_departments(department_id);

-- Migrate existing single department_id from exit_pipeline_stages
INSERT INTO exit_pipeline_stage_departments (stage_key, department_id, sort_order)
SELECT stage_key, department_id, 1
FROM exit_pipeline_stages
WHERE department_id IS NOT NULL
ON CONFLICT (stage_key, department_id) DO NOTHING;
