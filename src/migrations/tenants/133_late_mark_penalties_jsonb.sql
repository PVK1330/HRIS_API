-- 133_late_mark_penalties_jsonb.sql
-- Replace fixed penalty_3/penalty_6 columns with a flexible JSONB array so
-- each tenant can define any number of late-count thresholds and penalties.
-- Default mirrors the previous two-tier setup.

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS late_mark_penalties JSONB
    DEFAULT '[{"count":3,"result":"Half Day"},{"count":6,"result":"1 Leave Deduction"}]';

-- Seed from existing fixed columns where they differ from default
UPDATE attendance_settings
SET late_mark_penalties = jsonb_build_array(
  jsonb_build_object('count', 3, 'result', COALESCE(penalty_3_lates_result, 'Half Day')),
  jsonb_build_object('count', 6, 'result', COALESCE(penalty_6_lates_result, '1 Leave Deduction'))
)
WHERE penalty_3_lates_result IS NOT NULL OR penalty_6_lates_result IS NOT NULL;
