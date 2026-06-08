'use strict';

/**
 * Central email → tenant lookup index.
 *
 * Replaces the O(N) cross-tenant scan in auth.service.js with a single
 * SELECT on public.user_tenant_index.
 *
 * Write paths (upsertEntry / removeEntry) are hooked into:
 *   - employees.service.js  createEmployee / updateEmployee / deleteEmployee / completeOnboardingActivation
 *   - tenant.service.js     createTenant
 *
 * backfillAll() is called fire-and-forget at server startup (app.js) to seed
 * historical data that existed before this index was introduced.
 */

const { superAdminPool, getTenantPool } = require('../config/db');
const { normalizeLoginId } = require('./normalizeEmail');
const logger = require('./logger');

// Lazily-resolved promise so the CREATE TABLE IF NOT EXISTS only runs once per process.
let _schemaReady = null;

function ensureSchema() {
  if (!_schemaReady) {
    _schemaReady = superAdminPool
      .query(`
        CREATE TABLE IF NOT EXISTS public.user_tenant_index (
          normalized_email TEXT    NOT NULL,
          tenant_id        INTEGER NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          user_type        TEXT    NOT NULL CHECK (user_type IN ('admin', 'employee')),
          PRIMARY KEY (normalized_email, tenant_id)
        );
        CREATE INDEX IF NOT EXISTS idx_uti_email
          ON public.user_tenant_index (normalized_email);
        ALTER TABLE public.tenants
          ADD COLUMN IF NOT EXISTS slug TEXT;
        CREATE INDEX IF NOT EXISTS idx_tenants_slug
          ON public.tenants (slug);
      `)
      .catch((err) => {
        _schemaReady = null;
        throw err;
      });
  }
  return _schemaReady;
}

/**
 * Add or update one email → tenant mapping in the index.
 * Silently skips if email or tenantId is missing; logs warnings on DB errors.
 */
async function upsertEntry(email, tenantId, userType) {
  if (!email || !tenantId) return;
  const normalized = normalizeLoginId(email);
  if (!normalized) return;
  try {
    await ensureSchema();
    await superAdminPool.query(
      `INSERT INTO public.user_tenant_index (normalized_email, tenant_id, user_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (normalized_email, tenant_id)
       DO UPDATE SET user_type = EXCLUDED.user_type`,
      [normalized, tenantId, userType],
    );
  } catch (err) {
    logger.warn('[userTenantIndex] upsertEntry failed', {
      normalized,
      tenantId,
      err: err.message,
    });
  }
}

/**
 * Remove one email → tenant mapping (e.g. when an employee is soft-deleted).
 */
async function removeEntry(email, tenantId) {
  if (!email || !tenantId) return;
  const normalized = normalizeLoginId(email);
  if (!normalized) return;
  try {
    await ensureSchema();
    await superAdminPool.query(
      `DELETE FROM public.user_tenant_index
       WHERE normalized_email = $1 AND tenant_id = $2`,
      [normalized, tenantId],
    );
  } catch (err) {
    logger.warn('[userTenantIndex] removeEntry failed', {
      normalized,
      tenantId,
      err: err.message,
    });
  }
}

/**
 * Look up all tenants that contain a user with this email.
 * Returns an array of tenant rows joined with the user_type column.
 *
 * Returns [] on any error so callers can fall through to the legacy scan.
 *
 * @returns {Promise<Array<{id, name, db_name, status, plan_id, admin_email, user_type}>>}
 */
async function lookupTenants(email) {
  if (!email) return [];
  const normalized = normalizeLoginId(email);
  if (!normalized) return [];
  try {
    await ensureSchema();
    const { rows } = await superAdminPool.query(
      `SELECT t.id, t.name, t.db_name, t.status, t.plan_id, t.admin_email, i.user_type
       FROM public.user_tenant_index i
       JOIN public.tenants t ON t.id = i.tenant_id
       WHERE i.normalized_email = $1`,
      [normalized],
    );
    return rows;
  } catch (err) {
    logger.warn('[userTenantIndex] lookupTenants failed', {
      normalized,
      err: err.message,
    });
    return [];
  }
}

/**
 * Rebuild the index for a single tenant by reading its own DB.
 * Idempotent — all inserts use ON CONFLICT DO UPDATE.
 */
async function backfillTenant(tenantId, dbName) {
  await ensureSchema();
  const tenantPool = getTenantPool(dbName);

  const [{ rows: admins }, { rows: employees }] = await Promise.all([
    tenantPool.query(
      `SELECT email FROM admin_users WHERE status = 'active' AND email IS NOT NULL`,
    ),
    tenantPool.query(
      `SELECT work_email FROM employees
       WHERE deleted_at IS NULL
         AND portal_enabled = TRUE
         AND work_email IS NOT NULL
         AND TRIM(work_email) != ''`,
    ),
  ]);

  const entries = [
    ...admins.map((r) => [normalizeLoginId(r.email), tenantId, 'admin']),
    ...employees.map((r) => [normalizeLoginId(r.work_email), tenantId, 'employee']),
  ].filter(([e]) => Boolean(e));

  if (!entries.length) return;

  const placeholders = entries
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(', ');

  await superAdminPool.query(
    `INSERT INTO public.user_tenant_index (normalized_email, tenant_id, user_type)
     VALUES ${placeholders}
     ON CONFLICT (normalized_email, tenant_id) DO UPDATE
       SET user_type = EXCLUDED.user_type`,
    entries.flat(),
  );

  logger.debug(
    `[userTenantIndex] backfilled tenant ${tenantId} (${dbName}): ` +
    `${admins.length} admins + ${employees.length} employees`,
  );
}

/**
 * One-time startup backfill — indexes all active tenants and writes tenant slugs.
 * Called fire-and-forget from app.js; safe to re-run (fully idempotent).
 */
async function backfillAll() {
  await ensureSchema();
  const { slugifyTenantName } = require('./tenantSlug');

  const { rows: tenants } = await superAdminPool.query(
    `SELECT id, name, db_name, slug FROM public.tenants WHERE status = 'active'`,
  );

  let indexed = 0;
  let slugged = 0;

  for (const tenant of tenants) {
    if (!tenant.slug) {
      const computed = slugifyTenantName(tenant.name);
      if (computed) {
        await superAdminPool
          .query(
            `UPDATE public.tenants SET slug = $1 WHERE id = $2 AND slug IS NULL`,
            [computed, tenant.id],
          )
          .catch(() => {});
        slugged++;
      }
    }

    try {
      await backfillTenant(tenant.id, tenant.db_name);
      indexed++;
    } catch (err) {
      logger.warn(
        `[userTenantIndex] backfill skipped tenant ${tenant.id} (${tenant.db_name}): ${err.message}`,
      );
    }
  }

  logger.info(
    `[userTenantIndex] backfillAll done — ${indexed}/${tenants.length} tenants indexed, ` +
    `${slugged} slugs written`,
  );
}

module.exports = { upsertEntry, removeEntry, lookupTenants, backfillTenant, backfillAll };
