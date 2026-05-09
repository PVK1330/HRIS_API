-- 019_create_leave_types_table.sql
-- Tenant leave type catalog (defaults + custom types)

CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  paid_or_unpaid VARCHAR(10) DEFAULT 'Paid',
  annual_entitlement_days INTEGER DEFAULT 0,
  entitlement_label VARCHAR(30) DEFAULT NULL,
  accrual VARCHAR(20) DEFAULT 'Monthly',
  max_carry_forward_days INTEGER DEFAULT 0,
  loss_of_pay_rule VARCHAR(20) DEFAULT 'No LOP',
  document_required BOOLEAN DEFAULT false,
  auto_approval BOOLEAN DEFAULT false,
  approver VARCHAR(30) DEFAULT 'Manager',
  is_active BOOLEAN DEFAULT true,
  is_custom BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_leave_types_updated_at
  BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Annual Leave', 'Paid', 21, 'Monthly', 5, 'No LOP', 1, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Annual Leave'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Sick Leave', 'Paid', 10, 'Monthly', 0, 'No LOP', 2, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Sick Leave'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Unpaid Leave', 'Unpaid', 0, 'None', 0, 'Full LOP', 3, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Unpaid Leave'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Casual Leave', 'Paid', 6, 'Monthly', 0, 'No LOP', 4, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Casual Leave'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Emergency Leave', 'Paid', 3, 'None', 0, 'No LOP', 5, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Emergency Leave'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Maternity / Paternity', 'Paid', 90, 'None', 0, 'No LOP', 6, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Maternity / Paternity'))
);

INSERT INTO leave_types
  (name, paid_or_unpaid, annual_entitlement_days, accrual, max_carry_forward_days,
   loss_of_pay_rule, sort_order, is_custom)
SELECT 'Compensatory Off', 'Paid', 0, 'None', 0, 'No LOP', 7, false
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Compensatory Off'))
);

UPDATE leave_types
SET entitlement_label = 'Earned days'
WHERE name = 'Compensatory Off' AND is_custom = false;
