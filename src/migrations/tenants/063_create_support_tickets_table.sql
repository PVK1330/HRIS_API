-- Tenant migration: support tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  admin_name VARCHAR(255) NOT NULL,
  tenant_id INTEGER NOT NULL,
  tenant_name VARCHAR(255) NOT NULL,
  subject VARCHAR(400) NOT NULL,
  category VARCHAR(200) NOT NULL,
  priority VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  attachment_url VARCHAR(1024),
  status VARCHAR(50) NOT NULL DEFAULT 'Open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attach the notifications.ticket_id FK now that support_tickets exists. On a fresh tenant
-- migration 038 added the column but skipped the FK (table did not exist yet); add it here.
DO $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'fk_notifications_ticket_id'
         AND table_name = 'notifications'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'notifications' AND column_name = 'ticket_id'
     ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT fk_notifications_ticket_id
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
