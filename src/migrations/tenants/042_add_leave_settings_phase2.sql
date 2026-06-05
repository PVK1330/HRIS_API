-- 042_add_leave_settings_phase2.sql
-- Add fields for Phase 2 Leave Management Configuration

ALTER TABLE leave_types
ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS encashment_allowed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS document_mandatory_after_days INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS applicable_departments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS applicable_designations JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS applicable_employment_types JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS probation_restriction BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS minimum_service_months INTEGER DEFAULT 0;
