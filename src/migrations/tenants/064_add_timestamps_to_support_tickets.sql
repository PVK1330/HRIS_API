-- Tenant migration: add additional timestamp columns to support_tickets table
ALTER TABLE support_tickets
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
