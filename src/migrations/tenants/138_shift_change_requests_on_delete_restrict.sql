-- BUG-027: Change requested_shift_id FK from ON DELETE CASCADE to ON DELETE RESTRICT.
-- Deleting a shift was silently destroying the full history of shift-change requests.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shift_change_requests_requested_shift_id_fkey'
      AND conrelid = 'shift_change_requests'::regclass
  ) THEN
    ALTER TABLE shift_change_requests
      DROP CONSTRAINT shift_change_requests_requested_shift_id_fkey;
    ALTER TABLE shift_change_requests
      ADD CONSTRAINT shift_change_requests_requested_shift_id_fkey
      FOREIGN KEY (requested_shift_id) REFERENCES shifts(id) ON DELETE RESTRICT;
  END IF;
END $$;
