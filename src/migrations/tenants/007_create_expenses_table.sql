-- 007_create_expenses_table.sql
-- Expense claims and reimbursement

CREATE TABLE IF NOT EXISTS expenses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    expense_category    VARCHAR(100) NOT NULL, -- Travel, Meals, Accommodation, Equipment, Training, etc.
    expense_title       VARCHAR(255) NOT NULL,
    amount              DECIMAL(12,2) NOT NULL,
    currency            VARCHAR(10) NOT NULL DEFAULT 'AED',
    expense_date        DATE NOT NULL,
    payment_method      VARCHAR(50), -- Cash, Credit Card, Company Card, etc.
    project_department  VARCHAR(255),
    description         TEXT,
    receipt_url         VARCHAR(500),
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected, Reimbursed
    approved_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    reimbursed_at       TIMESTAMPTZ,
    reimbursement_note   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_employee_id ON expenses (employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (expense_category);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);

CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Expense approval workflow
CREATE TABLE IF NOT EXISTS expense_approvals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id          UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    approver_id         UUID NOT NULL REFERENCES employees(id) ON DELETE SET NULL,
    level               INTEGER NOT NULL, -- 1 = Manager, 2 = Finance, 3 = Director
    status              VARCHAR(50) NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected
    comments            TEXT,
    actioned_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense_id ON expense_approvals (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_approver_id ON expense_approvals (approver_id);
