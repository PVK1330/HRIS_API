-- 095_attendance_integrity_and_location.sql
-- Punch metadata, location tracking, audit actor columns

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS attendance_location_tracking BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS punch_timezone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS check_in_ip VARCHAR(64),
  ADD COLUMN IF NOT EXISTS check_out_ip VARCHAR(64),
  ADD COLUMN IF NOT EXISTS check_in_device TEXT,
  ADD COLUMN IF NOT EXISTS check_out_device TEXT,
  ADD COLUMN IF NOT EXISTS check_in_latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS check_in_longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS check_in_address TEXT,
  ADD COLUMN IF NOT EXISTS check_out_latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS check_out_longitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS check_out_address TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
