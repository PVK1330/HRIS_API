-- 028_make_asset_type_nullable.sql

ALTER TABLE assets ALTER COLUMN type DROP NOT NULL;
