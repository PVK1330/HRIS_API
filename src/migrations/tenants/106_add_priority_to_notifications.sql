-- 106_add_priority_to_notifications.sql
-- The notification insert writes a `priority` value, but no migration ever
-- created the column — so on tenants missing it EVERY notification insert fails
-- ("column priority does not exist") and notifications silently never appear.
-- Add it idempotently so notification creation works for all tenants.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
