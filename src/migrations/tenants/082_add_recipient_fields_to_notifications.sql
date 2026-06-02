-- Add recipient_id and recipient_role columns to notifications for proper filtering
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS recipient_id INT REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(50) DEFAULT NULL;

-- Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role ON notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_composite ON notifications(recipient_id, recipient_role);

-- Update existing records: if for_admin=true, set recipient_role to 'superadmin'
UPDATE notifications
SET recipient_role = 'superadmin'
WHERE for_admin = true AND recipient_role IS NULL;

-- For employee notifications, keep them as is
-- employee_id already links to the employee, so we can use that for filtering
