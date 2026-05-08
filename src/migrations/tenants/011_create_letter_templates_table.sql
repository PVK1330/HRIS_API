-- 011_create_letter_templates_table.sql
-- Letter templates and dispatch history

CREATE TABLE IF NOT EXISTS letter_templates (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(50)  NOT NULL DEFAULT 'Letter',  -- Letter, Form, Certificate, Report
    category    VARCHAR(100) NOT NULL,                   -- Recruitment, Compliance, Performance, Exit, HR, Finance, Leave, Disciplinary
    description TEXT         NOT NULL DEFAULT '',
    body        TEXT         NOT NULL DEFAULT '',
    status      VARCHAR(50)  NOT NULL DEFAULT 'Active',  -- Active, Draft
    usage_count INTEGER      NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_status   ON letter_templates (status);
CREATE INDEX IF NOT EXISTS idx_letter_templates_category ON letter_templates (category);

CREATE TRIGGER update_letter_templates_updated_at BEFORE UPDATE ON letter_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Dispatch history: every time a letter is sent to an employee
CREATE TABLE IF NOT EXISTS letter_dispatch_history (
    id           SERIAL PRIMARY KEY,
    template_id  INTEGER NOT NULL REFERENCES letter_templates(id) ON DELETE CASCADE,
    employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee     VARCHAR(255) NOT NULL,   -- snapshot of name at dispatch time
    template     VARCHAR(255) NOT NULL,   -- snapshot of template name
    sent_by      VARCHAR(255) NOT NULL,   -- admin name snapshot
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status       VARCHAR(50)  NOT NULL DEFAULT 'Delivered', -- Delivered, Failed
    body_snapshot TEXT,                   -- rendered body at time of dispatch
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_dispatch_template_id  ON letter_dispatch_history (template_id);
CREATE INDEX IF NOT EXISTS idx_letter_dispatch_employee_id  ON letter_dispatch_history (employee_id);
CREATE INDEX IF NOT EXISTS idx_letter_dispatch_sent_at      ON letter_dispatch_history (sent_at DESC);
