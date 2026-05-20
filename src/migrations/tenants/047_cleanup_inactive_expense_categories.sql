-- Remove soft-deleted category rows; delete is permanent, create always inserts fresh.

DELETE FROM expense_categories WHERE is_active = FALSE;
