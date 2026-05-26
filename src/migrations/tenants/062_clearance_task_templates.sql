CREATE TABLE IF NOT EXISTS clearance_task_templates (
  id            SERIAL PRIMARY KEY,
  department    VARCHAR(100)  NOT NULL,
  task_name     VARCHAR(255)  NOT NULL,
  sort_order    INT           NOT NULL DEFAULT 0,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_clearance_task_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clearance_task_templates_updated ON clearance_task_templates;
CREATE TRIGGER trg_clearance_task_templates_updated
  BEFORE UPDATE ON clearance_task_templates
  FOR EACH ROW EXECUTE FUNCTION update_clearance_task_templates_updated_at();

INSERT INTO clearance_task_templates (department, task_name, sort_order) VALUES
  ('IT',      'Revoke system access & email',       1),
  ('IT',      'Collect laptop & peripherals',        2),
  ('IT',      'Revoke VPN & security tokens',        3),
  ('HR',      'Collect ID card & access card',       4),
  ('HR',      'Process final settlement',            5),
  ('HR',      'Issue experience letter',             6),
  ('HR',      'Issue No Objection Certificate',      7),
  ('Finance', 'Clear pending reimbursements',        8),
  ('Finance', 'Process full & final settlement',     9),
  ('Admin',   'Return parking pass / keys',         10)
ON CONFLICT DO NOTHING;
