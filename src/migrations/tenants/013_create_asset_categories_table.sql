-- 013_create_asset_categories_table.sql

CREATE TABLE IF NOT EXISTS asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50) DEFAULT 'box',
  color VARCHAR(20) DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_asset_categories_updated_at
  BEFORE UPDATE ON asset_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'Laptop', 'laptop', '#3b82f6', 1
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('Laptop'));

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'Mobile', 'smartphone', '#8b5cf6', 2
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('Mobile'));

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'SIM Card', 'sim-card', '#06b6d4', 3
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('SIM Card'));

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'Access Card', 'credit-card', '#f59e0b', 4
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('Access Card'));

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'Uniform', 'shirt', '#10b981', 5
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('Uniform'));

INSERT INTO asset_categories (name, icon, color, sort_order)
SELECT 'Tools', 'tool', '#6b7280', 6
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE LOWER(name) = LOWER('Tools'));
