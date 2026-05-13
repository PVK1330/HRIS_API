-- 037_document_types_id_uuid_to_integer.sql
-- Convert document_types.id from UUID to INTEGER for simpler API param handling.

DO $$
DECLARE
  id_type TEXT;
  id_default TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'document_types'
  ) THEN
    RETURN;
  END IF;

  SELECT data_type, column_default
    INTO id_type, id_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'document_types'
    AND column_name = 'id';

  IF id_type = 'uuid' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'document_types'
        AND column_name = 'id_new'
    ) THEN
      ALTER TABLE document_types ADD COLUMN id_new INTEGER;
    END IF;

    CREATE SEQUENCE IF NOT EXISTS document_types_id_seq;
    ALTER TABLE document_types ALTER COLUMN id_new SET DEFAULT nextval('document_types_id_seq');

    WITH ordered AS (
      SELECT ctid, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, name ASC, ctid) AS rn
      FROM document_types
      WHERE id_new IS NULL
    )
    UPDATE document_types d
    SET id_new = o.rn
    FROM ordered o
    WHERE d.ctid = o.ctid;

    ALTER TABLE document_types DROP CONSTRAINT IF EXISTS document_types_pkey;
    ALTER TABLE document_types DROP COLUMN id;
    ALTER TABLE document_types RENAME COLUMN id_new TO id;
    ALTER TABLE document_types ALTER COLUMN id SET NOT NULL;
    ALTER TABLE document_types ADD CONSTRAINT document_types_pkey PRIMARY KEY (id);
    ALTER SEQUENCE document_types_id_seq OWNED BY document_types.id;
  ELSIF id_type = 'integer' THEN
    CREATE SEQUENCE IF NOT EXISTS document_types_id_seq;

    IF id_default IS NULL OR position('document_types_id_seq' in id_default) = 0 THEN
      ALTER TABLE document_types ALTER COLUMN id SET DEFAULT nextval('document_types_id_seq');
    END IF;
  END IF;

  PERFORM setval(
    'document_types_id_seq',
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM document_types), 1),
    true
  );
END $$;
