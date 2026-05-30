-- Track when announcement notifications were sent (avoid duplicate email/push)

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_announcements_scheduled_due
  ON announcements (schedule_date)
  WHERE status = 'Scheduled' AND dispatched_at IS NULL;
