-- 007_create_platform_features_table.sql
-- Creates the platform_features table for managing subscription plan features

CREATE TABLE IF NOT EXISTS public.platform_features (
    id            SERIAL PRIMARY KEY,
    feature_name  VARCHAR(255) NOT NULL UNIQUE,
    feature_code  VARCHAR(100) NOT NULL UNIQUE,
    feature_description   TEXT,
    feature_sort_order    INT DEFAULT 0,
    feature_is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_features_code ON public.platform_features (feature_code);
CREATE INDEX IF NOT EXISTS idx_platform_features_active ON public.platform_features (feature_is_active);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_platform_features_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_platform_features_updated_at ON public.platform_features;
CREATE TRIGGER update_platform_features_updated_at BEFORE UPDATE ON public.platform_features
    FOR EACH ROW EXECUTE FUNCTION update_platform_features_updated_at();
-- Insert updated default features
INSERT INTO public.platform_features 
(
    feature_name,
    feature_code,
    feature_description,
    feature_sort_order
) 
VALUES
('Employee Management', 'employee_management', 'Full employee directory and profile management', 1),

('Attendance Tracking', 'attendance_tracking', 'Track employee check-in/check-out and work hours', 2),

('Leave Management', 'leave_management', 'Leave requests, approvals, and balance tracking', 3),

('Document Management', 'document_management', 'Upload and manage employee documents', 4),

('Performance Reviews', 'performance_reviews', 'Employee performance evaluation and reviews', 5),

('Onboarding', 'onboarding', 'New employee onboarding workflows and checklists', 6),

('Exit Management', 'exit_management', 'Employee exit processes and clearance', 7),

('Payroll', 'payroll', 'Salary processing and payslip generation', 8),

('Expense Management', 'expense_management', 'Expense claims and reimbursements', 9),

('Billing & Invoicing', 'billing_invoicing', 'Tenant billing and invoice management', 10),

('Template Generation', 'template_generation', 'Template Generation', 11),

('Policies', 'policies', 'Company policy management and acknowledgements', 12),

('Reports & Analytics', 'reports_analytics', 'HR reports and data analytics', 13),

('Announcements', 'announcements', 'Company-wide announcements and notifications', 14),

('Task Management', 'task_management', 'Task Management', 15),

('Time Tracking', 'time_tracking', 'Detailed time tracking and project hours', 16),

('Asset Management', 'asset_management', 'Company asset assignment and tracking', 17),

('Shift Management', 'shift_management', 'Shift scheduling and management', 18),

('Overtime Management', 'overtime_management', 'Overtime calculation and approval', 19),

('Training & Development', 'training_development', 'Employee training programs and tracking', 20),

('Department', 'department', 'Employee Directory', 21),

('Projects', 'projects', 'Projects', 22),

('Visa & Nationality', 'visa_&_nationality', 'Visa & Nationality', 23)

ON CONFLICT (feature_code) DO NOTHING;
