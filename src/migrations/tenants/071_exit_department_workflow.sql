-- Replace enterprise exit workflow engine with department-based exit flow

-- Drop legacy workflow engine (FK order)
DROP TABLE IF EXISTS exit_workflow_form_submissions CASCADE;
DROP TABLE IF EXISTS exit_workflow_instance_steps CASCADE;
DROP TABLE IF EXISTS exit_workflow_instances CASCADE;
DROP TABLE IF EXISTS workflow_form_fields CASCADE;
DROP TABLE IF EXISTS workflow_step_forms CASCADE;
DROP TABLE IF EXISTS exit_workflow_step_assignees CASCADE;
DROP TABLE IF EXISTS exit_workflow_steps CASCADE;
DROP TABLE IF EXISTS exit_workflows CASCADE;

ALTER TABLE exit_records DROP COLUMN IF EXISTS workflow_instance_id;

ALTER TABLE exit_records
  ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(50) DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS workflow_configured BOOLEAN NOT NULL DEFAULT false;

-- Per-exit department approval sequence
CREATE TABLE IF NOT EXISTS exit_department_workflows (
    id                  SERIAL PRIMARY KEY,
    exit_record_id      INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    department_id       INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    department_head_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    step_order          INTEGER NOT NULL DEFAULT 1,
    is_mandatory        BOOLEAN NOT NULL DEFAULT true,
    remarks             TEXT,
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending',
    approved_by         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (exit_record_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_exit_dept_wf_exit ON exit_department_workflows(exit_record_id);
CREATE INDEX IF NOT EXISTS idx_exit_dept_wf_status ON exit_department_workflows(exit_record_id, status);

-- Approval action history
CREATE TABLE IF NOT EXISTS exit_approvals (
    id                  SERIAL PRIMARY KEY,
    exit_record_id      INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    workflow_step_id    INTEGER REFERENCES exit_department_workflows(id) ON DELETE SET NULL,
    action              VARCHAR(50) NOT NULL,
    actor_id            INTEGER,
    actor_name          VARCHAR(255),
    comments            TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_approvals_exit ON exit_approvals(exit_record_id);

-- Pipeline / status audit trail
CREATE TABLE IF NOT EXISTS exit_status_logs (
    id                  SERIAL PRIMARY KEY,
    exit_record_id      INTEGER NOT NULL REFERENCES exit_records(id) ON DELETE CASCADE,
    from_status         VARCHAR(50),
    to_status           VARCHAR(50),
    from_stage          VARCHAR(50),
    to_stage            VARCHAR(50),
    notes               TEXT,
    actor_id            INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_status_logs_exit ON exit_status_logs(exit_record_id);

-- Optional org default template (tenant DB = one org)
CREATE TABLE IF NOT EXISTS exit_organization_workflow_templates (
    id                  SERIAL PRIMARY KEY,
    department_id       INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    step_order          INTEGER NOT NULL DEFAULT 1,
    is_mandatory        BOOLEAN NOT NULL DEFAULT true,
    remarks             TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (department_id)
);

CREATE TRIGGER update_exit_dept_wf_updated_at
    BEFORE UPDATE ON exit_department_workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exit_org_wf_tpl_updated_at
    BEFORE UPDATE ON exit_organization_workflow_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
