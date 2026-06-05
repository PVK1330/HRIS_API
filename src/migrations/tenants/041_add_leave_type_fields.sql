-- 041_add_leave_type_fields.sql
-- Add granular configuration fields for Leave Types as requested by user

ALTER TABLE leave_types
ADD COLUMN IF NOT EXISTS code VARCHAR(20) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS carry_forward_allowed BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS notice_period_required INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS gender_restriction VARCHAR(20) DEFAULT 'Both';
