-- 045_create_expense_categories.sql
-- Tenant-level expense categories for dynamic classification

CREATE TABLE IF NOT EXISTS expense_categories (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    limit_amount    DECIMAL(12, 2),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_expense_categories_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_active ON expense_categories (is_active);
CREATE INDEX IF NOT EXISTS idx_expense_categories_sort ON expense_categories (sort_order, name);

CREATE TRIGGER update_expense_categories_updated_at
    BEFORE UPDATE ON expense_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS expense_category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_expense_category_id ON expenses (expense_category_id);

-- Default categories (idempotent)
INSERT INTO expense_categories (name, sort_order) VALUES
    ('Travel', 10),
    ('Food & Meals', 20),
    ('Accommodation', 30),
    ('Internet', 40),
    ('Fuel', 50),
    ('Office Supplies', 60),
    ('Client Meeting', 70),
    ('Medical', 80),
    ('Training & Certification', 90),
    ('Miscellaneous', 100)
ON CONFLICT (name) DO NOTHING;
