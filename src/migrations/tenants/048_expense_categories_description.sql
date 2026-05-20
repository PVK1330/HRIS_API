-- Expense category optional description (shown in admin UI)

ALTER TABLE expense_categories
    ADD COLUMN IF NOT EXISTS description TEXT;
