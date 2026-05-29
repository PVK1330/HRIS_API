-- Add ticket_id to notifications so notifications can reference related support tickets
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS ticket_id INT NULL REFERENCES support_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_ticket_id ON notifications(ticket_id);
