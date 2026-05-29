-- Migration: 066_enterprise_exit_workflow_engine.sql
-- Create Enterprise Exit Workflow Engine tables

-- 1. Workflow Template Engine
CREATE TABLE IF NOT EXISTS exit_workflows (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMP WITH TIME ZONE,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS exit_workflow_steps (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES exit_workflows(id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    step_type VARCHAR(100) NOT NULL, -- Approval, Clearance, Interview, FnF, Asset_Return, Form
    step_order INTEGER NOT NULL,
    is_parallel BOOLEAN DEFAULT false,
    is_mandatory BOOLEAN DEFAULT true,
    sla_days INTEGER DEFAULT 0,
    conditions JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exit_workflow_step_assignees (
    id SERIAL PRIMARY KEY,
    step_id INTEGER REFERENCES exit_workflow_steps(id) ON DELETE CASCADE,
    assignee_type VARCHAR(50) NOT NULL, -- Role, Department, Manager, SpecificUser
    assignee_value VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_step_forms (
    id SERIAL PRIMARY KEY,
    step_id INTEGER REFERENCES exit_workflow_steps(id) ON DELETE CASCADE,
    form_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_form_fields (
    id SERIAL PRIMARY KEY,
    form_id INTEGER REFERENCES workflow_step_forms(id) ON DELETE CASCADE,
    field_name VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- Text, Number, Date, Select, Boolean
    is_required BOOLEAN DEFAULT false,
    options JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Workflow Runtime Engine
CREATE TABLE IF NOT EXISTS exit_workflow_instances (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    workflow_id INTEGER REFERENCES exit_workflows(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Draft', -- Draft, Submitted, In_Approval, Clearance_Pending, FnF_Pending, Completed, Rejected, Withdrawn
    initiated_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    resignation_date DATE,
    last_working_day DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exit_workflow_instance_steps (
    id SERIAL PRIMARY KEY,
    instance_id INTEGER REFERENCES exit_workflow_instances(id) ON DELETE CASCADE,
    step_id INTEGER REFERENCES exit_workflow_steps(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Active, Approved, Rejected, Skipped
    assigned_to_users INTEGER[], -- Array of employee IDs
    assigned_to_roles VARCHAR(255)[], -- Array of role names
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exit_workflow_form_submissions (
    id SERIAL PRIMARY KEY,
    instance_step_id INTEGER REFERENCES exit_workflow_instance_steps(id) ON DELETE CASCADE,
    form_id INTEGER REFERENCES workflow_step_forms(id) ON DELETE CASCADE,
    submitted_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    data JSONB,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Audit Logging
CREATE TABLE IF NOT EXISTS exit_audit_logs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    instance_id INTEGER REFERENCES exit_workflow_instances(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    actor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
