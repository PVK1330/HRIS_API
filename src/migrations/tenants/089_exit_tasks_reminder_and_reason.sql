-- 089_exit_tasks_reminder_and_reason.sql
-- Add reminder state + delay reason tracking for exit tasks.

ALTER TABLE exit_tasks
  ADD COLUMN IF NOT EXISTS reminder_5d_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delay_reason TEXT,
  ADD COLUMN IF NOT EXISTS delay_reason_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_reason_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- Ensure legacy tasks receive a 7-day SLA target.
UPDATE exit_tasks
SET due_at = COALESCE(due_at, created_at + INTERVAL '7 days')
WHERE status = 'PENDING';
