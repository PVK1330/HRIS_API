-- 111_fix_notification_recipient_role_mislabel.sql
--
-- Reverses the incorrect backfill done in 082_add_recipient_fields_to_notifications.sql,
-- which set recipient_role = 'superadmin' for EVERY existing for_admin = true row:
--
--     UPDATE notifications SET recipient_role = 'superadmin'
--     WHERE for_admin = true AND recipient_role IS NULL;
--
-- Those rows are tenant-ADMIN notifications (leave/expense/asset/onboarding/exit/…),
-- not superadmin notifications. Mislabeling them:
--   * leaked every org's admin activity into the superadmin's cross-tenant feed, and
--   * hid them from the tenant admin (whose filter requires recipient_role IS NULL).
--
-- Genuine superadmin notifications (support tickets) are created with
-- for_admin = false and recipient_role = 'superadmin', so restricting this fix to
-- for_admin = true rows leaves them untouched.

UPDATE notifications
SET recipient_role = NULL
WHERE for_admin = true
  AND recipient_role = 'superadmin';
