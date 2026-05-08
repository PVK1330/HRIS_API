-- 012_create_letter_tags_table.sql
-- Custom dynamic tags for letter templates

CREATE TABLE IF NOT EXISTS letter_tags (
    id          SERIAL PRIMARY KEY,
    tag         VARCHAR(100) NOT NULL,          -- e.g. {{custom_field}}
    description VARCHAR(255) NOT NULL DEFAULT '',
    is_system   BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = built-in, cannot delete
    created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_letter_tags_tag UNIQUE (tag)
);

CREATE INDEX IF NOT EXISTS idx_letter_tags_is_system ON letter_tags (is_system);

CREATE TRIGGER update_letter_tags_updated_at BEFORE UPDATE ON letter_tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed built-in system tags
INSERT INTO letter_tags (tag, description, is_system) VALUES
  ('{{employee_name}}', 'Full name of the employee',        TRUE),
  ('{{employee_id}}',   'Unique employee identification',   TRUE),
  ('{{job_title}}',     'Designation of the employee',      TRUE),
  ('{{department}}',    'Department name',                  TRUE),
  ('{{joining_date}}',  'Date of joining',                  TRUE),
  ('{{salary}}',        'Gross monthly salary',             TRUE),
  ('{{today_date}}',    'Current date',                     TRUE),
  ('{{company_name}}',  'Standard company legal name',      TRUE)
ON CONFLICT (tag) DO NOTHING;
