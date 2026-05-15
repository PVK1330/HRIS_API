-- 015_superadmin_uuids_to_integers.sql
-- Convert remaining UUID primary keys in SuperAdmin schema to INTEGER.

DO $$
DECLARE
  t_name TEXT;
  tbls TEXT[] := ARRAY[
    'payment_gateways',
    'recaptcha_settings',
    'free_trial_settings',
    'account_settings',
    'currency_settings'
  ];
BEGIN
  FOREACH t_name IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = t_name AND column_name = 'id' AND data_type = 'uuid'
    ) THEN
      -- Add new column
      EXECUTE format('ALTER TABLE %I ADD COLUMN id_new SERIAL', t_name);
      
      -- Swap
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I_pkey CASCADE', t_name, t_name);
      EXECUTE format('ALTER TABLE %I DROP COLUMN id', t_name);
      EXECUTE format('ALTER TABLE %I RENAME COLUMN id_new TO id', t_name);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (id)', t_name);
    END IF;
  END LOOP;
END $$;
