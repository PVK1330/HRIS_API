-- 098: Attendance notification history and templates

-- Create notification_templates if it doesn't exist (assuming it might be missing or we need a dedicated one)
CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(100) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table to prevent duplicate attendance notifications (e.g., cron running twice)
CREATE TABLE IF NOT EXISTS attendance_notification_history (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL, -- e.g., attendance_id, holiday_id, date, etc.
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_notification_history_unique
    UNIQUE (event_type, entity_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_notification_history_event
  ON attendance_notification_history (event_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_attendance_notification_history_sent
  ON attendance_notification_history (sent_at DESC);
