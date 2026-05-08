'use strict';

/**
 * Runs all pending tenant migrations on every existing tenant database.
 *
 * Usage:
 *   node src/scripts/migrateTenants.js
 *
 * Safe to run multiple times — already-applied migrations are skipped via
 * the tenant_migrations tracking table inside each tenant DB.
 */

const db = require('../config/db');
const logger = require('../utils/logger');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');

async function migrateAllTenants() {
  const { rows } = await db.superAdminPool.query(
    `SELECT id, name, db_name FROM public.tenants ORDER BY id ASC`
  );

  if (rows.length === 0) {
    logger.info('[migrateTenants] No tenants found.');
    return;
  }

  logger.info(`[migrateTenants] Found ${rows.length} tenant(s). Running migrations...`);

  let success = 0;
  let failed  = 0;

  for (const tenant of rows) {
    try {
      const result = await runTenantMigrations(tenant.db_name);
      logger.info(
        `[migrateTenants] ✓ ${tenant.name} (${tenant.db_name}) — applied=${result.applied}, skipped=${result.skipped}`
      );
      success++;
    } catch (err) {
      logger.error(
        `[migrateTenants] ✗ ${tenant.name} (${tenant.db_name}) — ${err.message}`
      );
      failed++;
    }
  }

  logger.info(`[migrateTenants] Done. success=${success}, failed=${failed}`);
}

if (require.main === module) {
  (async () => {
    try {
      await db.assertDbConnection();
      await migrateAllTenants();
      await db.closeAllTenantPools();
      await db.superAdminPool.end();
      process.exit(0);
    } catch (err) {
      logger.error('[migrateTenants] Fatal error', err);
      process.exit(1);
    }
  })();
}

module.exports = { migrateAllTenants };
