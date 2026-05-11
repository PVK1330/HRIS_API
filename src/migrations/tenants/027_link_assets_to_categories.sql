-- 027_link_assets_to_categories.sql

ALTER TABLE assets 
  ADD COLUMN category_id UUID REFERENCES asset_categories(id) ON DELETE SET NULL;

-- Try to map existing types to categories
UPDATE assets a
SET category_id = ac.id
FROM asset_categories ac
WHERE LOWER(a.type) = LOWER(ac.name);
