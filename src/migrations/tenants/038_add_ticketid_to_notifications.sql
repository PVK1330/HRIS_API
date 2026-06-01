-- Add ticket_id to notifications so notifications can reference related support tickets.
-- NOTE: support_tickets is created later (063). On a fresh tenant the migrations run in
-- filename order, so support_tickets does not exist yet here. Add the column now and attach
-- the FK only if the table already exists; migration 063 (re)adds the FK once the table is
-- present. This keeps fresh-tenant creation from failing on migration order.
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS ticket_id INT NULL;

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'fk_notifications_ticket_id'
         AND table_name = 'notifications'
     ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT fk_notifications_ticket_id
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_ticket_id ON notifications(ticket_id);
