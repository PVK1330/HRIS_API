-- Tenant migration: support ticket replies table
CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  superadmin_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  internal_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups by ticket_id
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_id ON support_ticket_replies(ticket_id);

-- Create index for sorting by created_at
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_created_at ON support_ticket_replies(created_at DESC);
