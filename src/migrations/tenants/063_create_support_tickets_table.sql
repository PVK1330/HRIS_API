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
