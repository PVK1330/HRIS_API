-- 082_create_exit_clearance_items.sql
-- Reusable clearance-item catalog for Exit Management (Settings → Exit Management →
-- Clearance Items). Admins define named items once (Collect ID card, Deactivate access
-- card, Revoke credentials, …) and pick them when building a workflow stage's checklist.
-- The catalog only seeds stage checklist templates — there is NO FK from a workflow stage
-- back to a catalog row, so catalog edits/deletes never disturb existing workflows or
-- in-flight requests (the label/type are copied at build time).

CREATE TABLE IF NOT EXISTS exit_clearance_items (
  id                BIGSERIAL PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  -- Maps onto the exit engine's checklist item_type so picked items slot straight in.
  item_type         VARCHAR(24) NOT NULL DEFAULT 'TASK',
  default_mandatory BOOLEAN NOT NULL DEFAULT true,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_exit_clearance_item_type
    CHECK (item_type IN ('TASK','ASSET_RETURN','INTERVIEW','SETTLEMENT','DOCUMENT'))
);

CREATE INDEX IF NOT EXISTS idx_exit_clearance_items_active
  ON exit_clearance_items (is_active, sort_order);

-- Seed a sensible starter set (only when the catalog is empty, so re-runs / existing
-- tenants that already curated their list are left untouched).
INSERT INTO exit_clearance_items (name, description, item_type, default_mandatory, sort_order)
SELECT * FROM (VALUES
  ('Collect ID card',            'Retrieve the employee photo / ID card',          'TASK',         true,  1),
  ('Deactivate access card',     'Disable building / door access card',            'TASK',         true,  2),
  ('Revoke system credentials',  'Disable email, VPN and application logins',      'TASK',         true,  3),
  ('Return company assets',      'Collect laptop, phone and other issued assets',  'ASSET_RETURN', true,  4),
  ('Conduct exit interview',     'Complete the exit interview',                    'INTERVIEW',    false, 5),
  ('Final settlement',           'Process final pay and settlement',               'SETTLEMENT',   true,  6),
  ('Handover documents',         'Collect signed handover / NOC documents',        'DOCUMENT',     false, 7)
) AS seed(name, description, item_type, default_mandatory, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM exit_clearance_items);
