-- 027_user_tenant_index.sql
-- Central email → tenant lookup table so login resolves the correct tenant in O(1)
-- instead of querying every active tenant DB sequentially.
--
-- After applying this migration, run `backfillAll()` from utils/userTenantIndex.js
-- once (it is called automatically at server startup) to populate employee rows that
-- live in per-tenant DBs.  Admin email rows are seeded below from the central registry.

BEGIN;

-- 1. Email → tenant lookup table
CREATE TABLE IF NOT EXISTS public.user_tenant_index (
  normalized_email TEXT    NOT NULL,
  tenant_id        INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_type        TEXT    NOT NULL CHECK (user_type IN ('admin', 'employee')),
  PRIMARY KEY (normalized_email, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_uti_email
  ON public.user_tenant_index (normalized_email);

-- 2. Slug column on tenants for O(1) subdomain-based resolution
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_slug
  ON public.tenants (slug);

-- 3. Backfill admin emails from the central tenants registry.
--    Full Gmail dot-normalisation is handled in the application layer (normalizeLoginId);
--    here we just do LOWER(TRIM()) which is correct for non-Gmail addresses and a safe
--    approximation for Gmail (the app layer upserts the correct form on first login).
INSERT INTO public.user_tenant_index (normalized_email, tenant_id, user_type)
SELECT
  LOWER(TRIM(admin_email)),
  id,
  'admin'
FROM public.tenants
WHERE admin_email IS NOT NULL
  AND TRIM(admin_email) != ''
ON CONFLICT (normalized_email, tenant_id) DO UPDATE
  SET user_type = EXCLUDED.user_type;

-- 4. Backfill slugs from tenant names using the same algorithm as slugifyTenantName().
UPDATE public.tenants
SET slug = REGEXP_REPLACE(
             REGEXP_REPLACE(
               REGEXP_REPLACE(
                 REGEXP_REPLACE(
                   TRIM(LOWER(name)),
                   '\s+',   '-', 'g'
                 ),
                 '[^\w-]+', '',  'g'
               ),
               '-{2,}',    '-', 'g'
             ),
             '^-|-$',      '',  'g'
           )
WHERE slug IS NULL
  AND name IS NOT NULL
  AND TRIM(name) != '';

COMMIT;
