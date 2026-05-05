-- 007_create_features_table.sql
-- Creates the features table for managing subscription plan features

CREATE TABLE IF NOT EXISTS public.features (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL UNIQUE,
    code        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    category    VARCHAR(100), -- HR, Finance, Compliance, etc.
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_code ON public.features (code);
CREATE INDEX IF NOT EXISTS idx_features_category ON public.features (category);
CREATE INDEX IF NOT EXISTS idx_features_active ON public.features (is_active);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_features_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_features_updated_at ON public.features;
CREATE TRIGGER update_features_updated_at BEFORE UPDATE ON public.features
    FOR EACH ROW EXECUTE FUNCTION update_features_updated_at();

-- Insert default features
INSERT INTO public.features (name, code, description, category) VALUES
('Employee Management', 'employee_management', 'Full employee directory and profile management', 'HR'),
('Attendance Tracking', 'attendance_tracking', 'Track employee check-in/check-out and work hours', 'HR'),
('Leave Management', 'leave_management', 'Leave requests, approvals, and balance tracking', 'HR'),
('Document Management', 'document_management', 'Upload and manage employee documents', 'HR'),
('Performance Reviews', 'performance_reviews', 'Employee performance evaluation and reviews', 'HR'),
('Onboarding', 'onboarding', 'New employee onboarding workflows and checklists', 'HR'),
('Exit Management', 'exit_management', 'Employee exit processes and clearance', 'HR'),
('Payroll', 'payroll', 'Salary processing and payslip generation', 'Finance'),
('Expense Management', 'expense_management', 'Expense claims and reimbursements', 'Finance'),
('Billing & Invoicing', 'billing_invoicing', 'Tenant billing and invoice management', 'Finance'),
('Compliance', 'compliance', 'Visa, nationality, and regulatory compliance tracking', 'Compliance'),
('Policies', 'policies', 'Company policy management and acknowledgements', 'Compliance'),
('Reports & Analytics', 'reports_analytics', 'HR reports and data analytics', 'Analytics'),
('Announcements', 'announcements', 'Company-wide announcements and notifications', 'Communication'),
('Multi-location', 'multi_location', 'Support for multiple office locations', 'HR'),
('Time Tracking', 'time_tracking', 'Detailed time tracking and project hours', 'HR'),
('Asset Management', 'asset_management', 'Company asset assignment and tracking', 'HR'),
('Shift Management', 'shift_management', 'Shift scheduling and management', 'HR'),
('Overtime Management', 'overtime_management', 'Overtime calculation and approval', 'HR'),
('Training & Development', 'training_development', 'Employee training programs and tracking', 'HR')
ON CONFLICT (code) DO NOTHING;
