-- 017_create_document_types_table.sql
-- Tenant-configurable document type catalog

CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  is_required BOOLEAN DEFAULT true,
  mandatory_or_optional VARCHAR(10) DEFAULT 'Mandatory',
  who_must_upload VARCHAR(20) DEFAULT 'Employee',
  expiry_tracking BOOLEAN DEFAULT false,
  reminder_before_expiry_days INTEGER DEFAULT 30,
  hr_approval_required BOOLEAN DEFAULT false,
  visibility VARCHAR(40) DEFAULT 'HR only',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_document_types_updated_at
  BEFORE UPDATE ON document_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'National ID', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('National ID'))
);

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'Passport Copy', true, 2
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Passport Copy'))
);

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'Visa Copy', true, 3
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Visa Copy'))
);

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'Educational Certificates', true, 4
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Educational Certificates'))
);

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'Medical Documents', true, 5
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Medical Documents'))
);

INSERT INTO document_types (name, is_required, sort_order)
SELECT 'Bank Details', true, 6
WHERE NOT EXISTS (
  SELECT 1 FROM document_types t WHERE LOWER(TRIM(t.name)) = LOWER(TRIM('Bank Details'))
);
