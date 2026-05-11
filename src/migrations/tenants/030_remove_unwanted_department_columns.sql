-- 030_remove_unwanted_department_columns.sql

ALTER TABLE departments 
  DROP COLUMN IF EXISTS manager_id,
  DROP COLUMN IF EXISTS head_name,
  DROP COLUMN IF EXISTS budget;
