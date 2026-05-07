-- 014_create_asset_rules_table.sql

CREATE TABLE IF NOT EXISTS asset_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigning_rule VARCHAR(50) DEFAULT 'Manager assigns',
  return_rule VARCHAR(50) DEFAULT 'On last day',
  lost_damaged_policy VARCHAR(50) DEFAULT 'Employee pays',
  approval_workflow VARCHAR(50) DEFAULT 'Manager → HR',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_asset_rules_updated_at
  BEFORE UPDATE ON asset_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO asset_rules (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM asset_rules LIMIT 1);
