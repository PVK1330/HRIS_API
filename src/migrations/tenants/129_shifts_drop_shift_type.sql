-- Drop shift_type column — replaced by free-text shift name field in new UI
ALTER TABLE shifts DROP COLUMN IF EXISTS shift_type;
