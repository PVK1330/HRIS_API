-- 008_create_onboarding_table.sql
-- Onboarding task management

CREATE TABLE IF NOT EXISTS onboarding_tasks (
    id                  SERIAL PRIMARY KEY,
    employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    task_name           VARCHAR(255) NOT NULL,
    task_category       VARCHAR(100), -- HR, IT, Manager, Admin
    due_date            DATE,
    assigned_to         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    priority            VARCHAR(20) NOT NULL DEFAULT 'Medium', -- High, Medium, Low
    description         TEXT,
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, In Progress, Done, Overdue
    completed_at        TIMESTAMPTZ,
    completed_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_employee_id ON onboarding_tasks (employee_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_assigned_to ON onboarding_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_status ON onboarding_tasks (status);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_due_date ON onboarding_tasks (due_date);

CREATE TRIGGER update_onboarding_tasks_updated_at BEFORE UPDATE ON onboarding_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
