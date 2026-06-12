-- 121_expenses_vat_payment_receipt_required.sql
-- EXP-15: VAT/tax amount on claims
-- EXP-19: Payment reference + date when marking Paid
-- EXP-13: receipt_required flag per category (block submission without receipt)

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_date DATE;

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_expenses_payment_reference
  ON expenses (payment_reference) WHERE payment_reference IS NOT NULL;
