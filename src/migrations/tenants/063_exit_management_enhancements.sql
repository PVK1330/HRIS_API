-- 063_exit_management_enhancements.sql
-- Add columns for SLA hourly escalations, resignation withdrawals, and task proof attachments

-- 1. SLA & Due Date Fields for clearance tasks & templates
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 0;
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN DEFAULT false;

ALTER TABLE clearance_task_templates ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 0;

-- 2. Resignation Withdrawal Workflow Columns
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS is_withdrawal_requested BOOLEAN DEFAULT false;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS withdrawal_status VARCHAR(50) CHECK (withdrawal_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS withdrawal_requested_at TIMESTAMPTZ;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS withdrawal_approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE exit_records ADD COLUMN IF NOT EXISTS withdrawal_approved_at TIMESTAMPTZ;

-- 3. Clearance Task Attachments (Proof Uploads)
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS document_url VARCHAR(500);
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);
ALTER TABLE clearance_tasks ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;

-- Create index on tasks for escalations and attachments
CREATE INDEX IF NOT EXISTS idx_clearance_tasks_escalation ON clearance_tasks (is_completed, due_date) WHERE is_completed = false;
CREATE INDEX IF NOT EXISTS idx_exit_records_withdrawal ON exit_records (is_withdrawal_requested, withdrawal_status);
