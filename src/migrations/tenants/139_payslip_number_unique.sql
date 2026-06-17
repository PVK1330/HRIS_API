-- BUG-028: Add UNIQUE constraint on payslips.payslip_number to prevent duplicate
-- payslip reference numbers across payroll runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_payslip_number'
      AND conrelid = 'payslips'::regclass
  ) THEN
    ALTER TABLE payslips ADD CONSTRAINT uq_payslip_number UNIQUE (payslip_number);
  END IF;
END $$;
