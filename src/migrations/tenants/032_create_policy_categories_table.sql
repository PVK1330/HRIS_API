-- 032_create_policy_categories_table.sql
CREATE TABLE IF NOT EXISTS policy_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  icon_name VARCHAR(50) DEFAULT 'HiDocumentText',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default categories
INSERT INTO policy_categories (name, icon_name) VALUES 
('General', 'HiDocumentText'),
('HR Policies', 'HiUserGroup'),
('IT & Security', 'HiShieldCheck'),
('Compliance', 'HiShieldCheck'),
('Code of Conduct', 'HiDocumentText'),
('Safety & Health', 'HiShieldCheck'),
('Financial', 'HiDocumentText'),
('Remote Work', 'HiClock'),
('Leave & Absence', 'HiClock')
ON CONFLICT (name) DO NOTHING;

-- Note: We keep the category column in policies as a string for now to avoid breaking existing data, 
-- or we could migrate it. Given it's a new feature, let's keep it simple or add category_id.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES policy_categories(id);
