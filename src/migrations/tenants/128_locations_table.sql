-- Tenant locations: named sites used for geo-fencing and shift assignment
CREATE TABLE IF NOT EXISTS locations (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  code          VARCHAR(50),
  address       TEXT,
  city          VARCHAR(100),
  state         VARCHAR(100),
  country       VARCHAR(100) DEFAULT 'India',
  latitude      NUMERIC(10, 7),
  longitude     NUMERIC(10, 7),
  radius_meters INTEGER NOT NULL DEFAULT 200,
  timezone      VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
  description   TEXT,
  created_by    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_status ON locations(status);
CREATE INDEX IF NOT EXISTS idx_locations_name   ON locations(name);
