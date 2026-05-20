-- Allow reusing category names after soft-delete (unique only among active rows)

ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS uq_expense_categories_name;

DROP INDEX IF EXISTS uq_expense_categories_name_active;

CREATE UNIQUE INDEX uq_expense_categories_name_active
    ON expense_categories (LOWER(TRIM(name)))
    WHERE is_active = TRUE;
