-- Add soft delete columns for role-wise ticket deletion
ALTER TABLE support_tickets
ADD COLUMN IF NOT EXISTS admin_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS superadmin_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS superadmin_deleted_at TIMESTAMP WITH TIME ZONE;
