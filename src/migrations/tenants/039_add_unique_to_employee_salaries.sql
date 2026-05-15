-- Migration: Add Unique Constraint to Employee Salaries
-- Path: d:\HRIS_API\src\migrations\tenants\039_add_unique_to_employee_salaries.sql

ALTER TABLE employee_salaries ADD CONSTRAINT uq_employee_salary_employee_id UNIQUE (employee_id);
