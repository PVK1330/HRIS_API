-- 016_create_notification_settings_table.sql
-- Tenant-scoped notification channels and event routing

CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email_notifications BOOLEAN DEFAULT false,
  sms_notifications BOOLEAN DEFAULT false,
  in_app_alerts BOOLEAN DEFAULT false,

  event_notifications JSONB DEFAULT $EVT$
{
    "leave_approval": {"email": true, "sms": false, "in_app": true},
    "document_approval": {"email": true, "sms": false, "in_app": true},
    "visa_expiry": {"email": true, "sms": false, "in_app": true},
    "policy_assignment": {"email": true, "sms": false, "in_app": true},
    "performance_review_due": {"email": true, "sms": false, "in_app": true},
    "asset_issue_return": {"email": true, "sms": false, "in_app": true},
    "attendance_reminders": {"email": true, "sms": false, "in_app": true}
}
$EVT$::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO notification_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM notification_settings LIMIT 1);
