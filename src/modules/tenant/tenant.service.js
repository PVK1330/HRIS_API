'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const db = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./tenant.repository');

const SALT_ROUNDS = 12;
const TENANT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations', 'tenants');

/**
 * Reads all `*.sql` files in src/migrations/tenants/ in lexicographic order
 * and executes them inside the given tenant schema using SET search_path.
 *
 * Must be called within an active transaction (the caller passes its `client`).
 *
 * @param {string} schemaName  e.g. "tenant_ab12_cd34_..."
 * @param {import('pg').PoolClient} client  pg client already inside a transaction
 */
async function runTenantMigrations(schemaName, client) {
  if (!fs.existsSync(TENANT_MIGRATIONS_DIR)) {
    throw new Error(`Tenant migrations directory not found: ${TENANT_MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(TENANT_MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.warn(`No tenant migration files found in ${TENANT_MIGRATIONS_DIR}`);
    return;
  }

  await repo.setSearchPath(schemaName, client);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(TENANT_MIGRATIONS_DIR, file), 'utf8');
    if (!sql.trim()) continue;

    logger.info(`[tenant:${schemaName}] applying migration ${file}`);
    await client.query(sql);
  }

  // Reset search_path to avoid leaking state once the transaction continues.
  await client.query('SET search_path TO public');
  logger.info(`[tenant:${schemaName}] migrations applied (${files.length} file(s))`);
}

/**
 * Creates a new tenant (Admin organization):
 *   1. Validate uniqueness of admin_email
 *   2. Generate a safe schema_name = tenant_<uuid>
 *   3. INSERT INTO public.tenants
 *   4. CREATE SCHEMA <schema_name>
 *   5. Run tenant migrations inside that schema
 *   6. INSERT admin user into <schema_name>.admin_users
 *
 * Everything happens in a single transaction so that any failure
 * cleanly rolls back the registry row AND the schema.
 *
 * @param {object} input
 * @param {string} input.name           Tenant / organization name
 * @param {string} input.adminEmail     Admin user email
 * @param {string} input.adminName      Admin user name
 * @param {string} input.adminPassword  Admin user plain-text password
 * @param {string} input.createdBy      SuperAdmin id from req.user.id
 */
async function createTenant({ name, adminEmail, adminName, adminPassword, createdBy }) {
  const normalizedEmail = String(adminEmail).trim().toLowerCase();
  const cleanName = String(name).trim();
  const cleanAdminName = String(adminName).trim();

  // Pre-flight uniqueness check (cheap & gives nicer 409 than a raw PG error).
  const existing = await repo.findTenantByAdminEmail(normalizedEmail);
  if (existing) {
    throw ApiError.conflict('A tenant with this admin email already exists');
  }

  const schemaName = `tenant_${uuidv4().replace(/-/g, '_')}`;
  // Defensive: enforce 63-char Postgres identifier limit.
  if (schemaName.length > 63) {
    throw ApiError.internal('Generated schema name exceeds 63 characters');
  }

  const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

  try {
    const tenant = await db.withTransaction(async (client) => {
      const tenantRow = await repo.insertTenant(
        {
          name: cleanName,
          schemaName,
          adminEmail: normalizedEmail,
          createdBy,
        },
        client
      );

      await repo.createSchema(schemaName, client);

      await runTenantMigrations(schemaName, client);

      await repo.insertAdminUser(
        schemaName,
        {
          tenantId: tenantRow.id,
          email: normalizedEmail,
          passwordHash,
          name: cleanAdminName,
        },
        client
      );

      return tenantRow;
    });

    logger.info(`Tenant created: ${tenant.name} (schema=${tenant.schema_name})`);

    return {
      id: tenant.id,
      name: tenant.name,
      schemaName: tenant.schema_name,
      adminEmail: tenant.admin_email,
      status: tenant.status,
      createdAt: tenant.created_at,
    };
  } catch (err) {
    // The transaction has already rolled back, so the registry row is gone.
    // The schema may also be gone (created inside the same tx) but be defensive.
    try {
      await repo.dropSchemaIfExists(schemaName);
    } catch (cleanupErr) {
      logger.error(`Failed to clean up schema ${schemaName}`, cleanupErr.message);
    }

    if (err instanceof ApiError) throw err;

    // Map common Postgres error codes to friendly responses.
    if (err && err.code === '23505') {
      throw ApiError.conflict('Tenant with this admin email or schema already exists');
    }
    if (err && err.code === '42P06') {
      throw ApiError.conflict('Schema already exists');
    }

    logger.error('createTenant failed', err);
    throw ApiError.internal('Failed to create tenant');
  }
}

module.exports = {
  createTenant,
  runTenantMigrations,
};
