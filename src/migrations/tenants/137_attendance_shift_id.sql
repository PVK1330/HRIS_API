-- Add shift_id to attendance so each record knows which shift the employee
-- was supposed to be on. Populated at mark-time (check-in or cron absent).
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;
