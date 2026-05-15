-- 040_convert_remaining_uuids_to_integers.sql
-- Bulk conversion of UUID primary keys to INTEGER across all identified tenant tables.

DO $$
DECLARE
  t_name TEXT;
  tbls TEXT[] := ARRAY[
    'tenant_admin_settings',
    'attendance_settings',
    'asset_categories',
    'asset_rules',
    'notification_settings',
    'password_security_settings',
    'sensitive_data_settings',
    'leave_types',
    'announcements'
  ];
BEGIN
  -- Phase 1: Add new integer ID columns to all target tables
  FOREACH t_name IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = t_name AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
      -- Add new column and populate with serial values IF NOT ALREADY THERE
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t_name AND column_name = 'id_new') THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN id_new SERIAL', t_name);
      END IF;
    END IF;
  END LOOP;

  -- Phase 2: Handle Foreign Key data migration (e.g., assets -> asset_categories)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assets') THEN
    -- Only proceed if category_id is still UUID
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'category_id' AND data_type = 'uuid') THEN
      -- Add temporary integer FK column if not exists
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'category_id_new') THEN
        ALTER TABLE assets ADD COLUMN category_id_new INTEGER;
      END IF;
      
      -- Map existing UUID FKs to new Integer IDs
      UPDATE assets a 
      SET category_id_new = ac.id_new 
      FROM asset_categories ac 
      WHERE a.category_id = ac.id
      AND ac.id_new IS NOT NULL;
      
      -- Drop old UUID FK
      ALTER TABLE assets DROP COLUMN category_id;
    END IF;
  END IF;

  -- Phase 3: Swap IDs and establish Primary Keys
  FOREACH t_name IN ARRAY tbls LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t_name AND column_name = 'id_new') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I_pkey CASCADE', t_name, t_name);
      
      -- Only drop 'id' if it's still there
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t_name AND column_name = 'id') THEN
         EXECUTE format('ALTER TABLE %I DROP COLUMN id', t_name);
      END IF;
      
      EXECUTE format('ALTER TABLE %I RENAME COLUMN id_new TO id', t_name);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (id)', t_name);
    END IF;
  END LOOP;

  -- Phase 4: Finalize Foreign Keys and Constraints
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'category_id_new') THEN
    ALTER TABLE assets RENAME COLUMN category_id_new TO category_id;
    ALTER TABLE assets ADD CONSTRAINT fk_assets_category FOREIGN KEY (category_id) REFERENCES asset_categories(id) ON DELETE SET NULL;
  END IF;

END $$;
