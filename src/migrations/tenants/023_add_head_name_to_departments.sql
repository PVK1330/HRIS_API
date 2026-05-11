-- 023_add_head_name_to_departments.sql

ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_name VARCHAR(255);
