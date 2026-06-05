-- 104_seed_lookup_options.sql
-- Generic, industry-agnostic lookup lists (nationalities, work locations) that
-- drive form dropdowns dynamically. Seeded with sensible defaults; admins can
-- extend rows later. Idempotent.

CREATE TABLE IF NOT EXISTS lookup_options (
    id          SERIAL PRIMARY KEY,
    category    VARCHAR(40)  NOT NULL,
    value       VARCHAR(120) NOT NULL,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_options_cat_value
  ON lookup_options (category, LOWER(value));
CREATE INDEX IF NOT EXISTS idx_lookup_options_category ON lookup_options (category);

-- Nationalities (common demonyms).
INSERT INTO lookup_options (category, value, sort_order)
SELECT 'nationality', v.value, v.ord
FROM (VALUES
  ('Indian',1),('Pakistani',2),('Bangladeshi',3),('Sri Lankan',4),('Nepali',5),
  ('Filipino',6),('Emirati',7),('Saudi',8),('Qatari',9),('Kuwaiti',10),
  ('Bahraini',11),('Omani',12),('Egyptian',13),('Jordanian',14),('Lebanese',15),
  ('British',16),('American',17),('Canadian',18),('Australian',19),('Irish',20),
  ('French',21),('German',22),('Italian',23),('Spanish',24),('Dutch',25),
  ('Chinese',26),('Japanese',27),('Korean',28),('Malaysian',29),('Singaporean',30),
  ('Indonesian',31),('Thai',32),('Vietnamese',33),('South African',34),('Nigerian',35),
  ('Kenyan',36),('Turkish',37),('Russian',38),('Brazilian',39),('Other',99)
) AS v(value, ord)
ON CONFLICT DO NOTHING;

-- Work locations (generic, industry-agnostic).
INSERT INTO lookup_options (category, value, sort_order)
SELECT 'work_location', v.value, v.ord
FROM (VALUES
  ('Headquarters',1),('Branch Office',2),('Regional Office',3),('Remote',4),
  ('Client Site',5),('Factory / Plant',6),('Warehouse',7),('Retail Store',8)
) AS v(value, ord)
ON CONFLICT DO NOTHING;
