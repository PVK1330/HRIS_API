-- 081_seed_exit_workflow_defaults.sql
-- Runs for EVERY tenant, so it only seeds tenant-neutral lookup data and a single
-- INACTIVE scaffold (no department/role FKs that may not exist in a bare tenant).
-- Demo Corp's real workflow + users come from seedDemoCorp.js, NOT a migration.

BEGIN;

-- Re-seed termination_types lookup
INSERT INTO termination_types (name, sort_order) VALUES
  ('Resignation',1),('Retirement',2),('End of Contract',3),
  ('Dismissal',4),('Redundancy',5),('Mutual Separation',6)
ON CONFLICT (name) DO NOTHING;

-- A single inactive starter workflow so the admin UI has something to clone.
INSERT INTO exit_workflows (name, description, is_active, is_default)
SELECT 'Default Exit Workflow (template)',
       'Starter scaffold. Configure stages under Settings > Exit Management.',
       false, false
WHERE NOT EXISTS (SELECT 1 FROM exit_workflows);

COMMIT;
