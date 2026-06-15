-- 031_drop_dead_dept_approval_columns.sql
-- Migration 109 (109_leave_dept_approval.sql) added dept_approved_by, dept_approved_at,
-- and dept_remarks to leave_requests, but the application code never writes to them.
-- The canonical department-approval columns from migration 101 are
-- department_approved_by and department_approved_at.  Drop the dead duplicates.

ALTER TABLE leave_requests DROP COLUMN IF EXISTS dept_approved_by;
ALTER TABLE leave_requests DROP COLUMN IF EXISTS dept_approved_at;
ALTER TABLE leave_requests DROP COLUMN IF EXISTS dept_remarks;
