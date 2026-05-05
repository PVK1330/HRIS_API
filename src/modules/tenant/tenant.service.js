'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const db = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./tenant.repository');

const SALT_ROUNDS = env.BCRYPT_SALT_ROUNDS;
const TENANT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations', 'tenants');

const TENANT_TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenant_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/**
 * Runs every *.sql file in src/migrations/tenants/ inside the given tenant
 * DATABASE (not schema). Uses a temporary pg.Pool so we don't pollute the
 * cached tenant pool, and tracks applied filenames in a `tenant_migrations`
 * table inside the tenant DB so subsequent runs are idempotent.
 *
 * @param {string} dbName  e.g. "tenant_ab12_cd34_..."
 */
async function runTenantMigrations(dbName) {
  repo.assertSafeDbName(dbName);

  if (!fs.existsSync(TENANT_MIGRATIONS_DIR)) {
    throw new Error(`Tenant migrations directory not found: ${TENANT_MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(TENANT_MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.warn(`No tenant migration files found in ${TENANT_MIGRATIONS_DIR}`);
    return { applied: 0, skipped: 0 };
  }

  // Temporary pool dedicated to running migrations on this tenant DB.
  const tempPool = new Pool({
    user: env.DB.user,
    password: env.DB.password,
    database: dbName,
    host: env.DB.host,
    port: env.DB.port,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });

  let applied = 0;
  let skipped = 0;

  try {
    const client = await tempPool.connect();
    try {
      await client.query(TENANT_TRACKING_TABLE_SQL);
      const { rows } = await client.query('SELECT filename FROM tenant_migrations');
      const alreadyApplied = new Set(rows.map((r) => r.filename));

      for (const file of files) {
        if (alreadyApplied.has(file)) {
          skipped += 1;
          logger.info(`[tenant:${dbName}] skip migration (already applied): ${file}`);
          continue;
        }

        const sql = fs.readFileSync(path.join(TENANT_MIGRATIONS_DIR, file), 'utf8');
        if (!sql.trim()) continue;

        logger.info(`[tenant:${dbName}] applying migration ${file}`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO tenant_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          await client.query('COMMIT');
          applied += 1;
          logger.info(`[tenant:${dbName}] done migration ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error(`[tenant:${dbName}] FAILED migration ${file}`, err.message);
          throw err;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    try {
      await tempPool.end();
    } catch (_) {
      // ignore — temp pool is throwaway
    }
  }

  logger.info(
    `[tenant:${dbName}] migrations complete (applied=${applied}, skipped=${skipped})`
  );
  return { applied, skipped };
}

/**
 * Drops a tenant database. Closes any cached tenant pool first and
 * terminates any other lingering connections so PG will allow the drop.
 */
async function dropTenantDatabaseIfExists(dbName) {
  repo.assertSafeDbName(dbName);

  // 1. Release any open connections owned by this app to the tenant DB.
  try {
    await db.closeTenantPool(dbName);
  } catch (e) {
    logger.warn(`Could not close tenant pool for ${dbName}: ${e.message}`);
  }

  // 2. Use the SuperAdmin pool (connected to hrs_backend) to drop the DB.
  const client = await db.superAdminPool.connect();
  try {
    // Best-effort: terminate any other backends still connected to this DB.
    try {
      await client.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
    } catch (e) {
      logger.warn(`Could not terminate backends for ${dbName}: ${e.message}`);
    }

    // DROP DATABASE cannot run inside a transaction.
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    logger.info(`[tenant] dropped database ${dbName}`);
  } finally {
    client.release();
  }
}

/**
 * Creates a brand-new tenant on a SEPARATE PostgreSQL database.
 *
 * Flow:
 *   1. Pre-flight uniqueness check on public.tenants.admin_email.
 *   2. Generate db_name = tenant_<uuid_without_dashes>.
 *   3. CREATE DATABASE <db_name> via superAdminPool (NOT inside a transaction).
 *   4. INSERT INTO public.tenants (hrs_backend) — stores db_name.
 *   5. Run tenant migrations inside the new DB (admin_users, roles, ...).
 *   6. INSERT admin_users row inside the tenant DB via getTenantPool(db_name).
 *
 * Cleanup: if any step after CREATE DATABASE fails, the tenants registry
 * row is removed and the new database is dropped, so partial state never
 * lingers.
 */
async function createTenant({ name, adminEmail, adminName, adminPassword, createdBy }) {
  const normalizedEmail = String(adminEmail).trim().toLowerCase();
  const cleanName = String(name).trim();
  const cleanAdminName = String(adminName).trim();

  // 1. Cheap uniqueness check (gives a clean 409 instead of a raw PG error).
  const existing = await repo.findTenantByAdminEmail(normalizedEmail);
  if (existing) {
    throw ApiError.conflict('A tenant with this admin email already exists');
  }

  // 2. Generate safe db_name (system-generated UUID — interpolation is safe).
  const dbName = `tenant_${uuidv4().replace(/-/g, '_')}`;
  if (dbName.length > 63) {
    throw ApiError.internal('Generated database name exceeds 63 characters');
  }
  repo.assertSafeDbName(dbName);

  const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

  let dbCreated = false;
  let tenantInserted = false;

  try {
    // 3. CREATE DATABASE — must NOT be inside a transaction.
    const adminClient = await db.superAdminPool.connect();
    try {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      dbCreated = true;
      logger.info(`[tenant] created database ${dbName}`);
    } catch (err) {
      if (err && err.code === '42P04') {
        throw new ApiError(409, 'Tenant database already exists');
      }
      logger.error(`[tenant] CREATE DATABASE failed for ${dbName}`, err.message);
      throw new ApiError(500, 'Failed to create tenant database');
    } finally {
      adminClient.release();
    }

    // 4. Insert into public.tenants (registry in hrs_backend).
    let tenantRow;
    try {
      tenantRow = await repo.insertTenant({
        name: cleanName,
        dbName,
        adminEmail: normalizedEmail,
        createdBy,
      });
      tenantInserted = true;
    } catch (err) {
      if (err && err.code === '23505') {
        throw ApiError.conflict(
          'Tenant with this admin email or database already exists'
        );
      }
      throw err;
    }

    // 5. Run tenant migrations inside the new DB.
    await runTenantMigrations(dbName);

    // 6. Insert admin_users row inside the tenant DB via cached pool.
    const tenantPool = db.getTenantPool(dbName);
    await repo.insertAdminUser(tenantPool, {
      tenantId: tenantRow.id,
      email: normalizedEmail,
      passwordHash,
      name: cleanAdminName,
    });

    logger.info(`Tenant created: ${tenantRow.name} (db=${tenantRow.db_name})`);

    return {
      id: tenantRow.id,
      name: tenantRow.name,
      dbName: tenantRow.db_name,
      adminEmail: tenantRow.admin_email,
      status: tenantRow.status,
      createdAt: tenantRow.created_at,
    };
  } catch (err) {
    // ---- Cleanup / rollback ----
    if (tenantInserted) {
      try {
        await repo.deleteTenantByDbName(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to delete tenants row for ${dbName}: ${cleanupErr.message}`
        );
      }
    }
    if (dbCreated) {
      try {
        await dropTenantDatabaseIfExists(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to drop tenant database ${dbName}: ${cleanupErr.message}`
        );
      }
    }

    if (err instanceof ApiError) throw err;

    if (err && err.code === '23505') {
      throw ApiError.conflict('Tenant with this admin email or database already exists');
    }

    logger.error('createTenant failed', err);
    throw new ApiError(500, 'Failed to create tenant');
  }
}

module.exports = {
  createTenant,
  runTenantMigrations,
  dropTenantDatabaseIfExists,
};
