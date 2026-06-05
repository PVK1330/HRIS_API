-- 106_overtime_approver_options.sql
-- Switch the overtime approver to department-style roles and remap any legacy value.

ALTER TABLE attendance_settings ALTER COLUMN overtime_approver SET DEFAULT 'HR Department';

UPDATE attendance_settings
   SET overtime_approver = 'HR Department'
 WHERE overtime_approver IS NULL
    OR overtime_approver NOT IN ('HR Department', 'Direct Manager', 'HOD', 'Manager + HR');
