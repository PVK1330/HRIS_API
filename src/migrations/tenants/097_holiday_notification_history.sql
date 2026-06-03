-- 097: Deduplicate holiday notifications (email + in-app)

CREATE TABLE IF NOT EXISTS holiday_notification_history (
  id SERIAL PRIMARY KEY,
  holiday_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  notification_type VARCHAR(64) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holiday_notification_history_unique
    UNIQUE (holiday_id, employee_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_holiday_notification_history_holiday
  ON holiday_notification_history (holiday_id);

CREATE INDEX IF NOT EXISTS idx_holiday_notification_history_sent
  ON holiday_notification_history (sent_at DESC);
