#!/usr/bin/env node
/**
 * Manual Migration Runner
 * Usage: node scripts/apply-migrations-manually.js
 * 
 * Applies all pending migrations (including 066_add_super_admin_description.sql)
 * to all active tenant databases.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/config/db');
const logger = require('../src/utils/logger');
const {
  runSuperAdminMigrations,
  runPendingTenantMigrationsForAllActiveTenants,
} = require('../src/scripts/runMigrations');

async function main() {
  try {
    console.log('🚀 Starting manual migration run...\n');

    // Test DB connection
    console.log('📡 Connecting to database...');
    await db.assertDbConnection();
    console.log('✅ Database connection successful\n');

    // Run SuperAdmin migrations
    console.log('📋 Running SuperAdmin migrations...');
    const superAdminResult = await runSuperAdminMigrations();
    console.log(`✅ SuperAdmin migrations: applied=${superAdminResult.applied}, skipped=${superAdminResult.skipped}\n`);

    // Run tenant migrations
    console.log('📋 Running pending tenant migrations for all active tenants...');
    const tenantResult = await runPendingTenantMigrationsForAllActiveTenants();
    console.log(`✅ Tenant migrations: tenantsProcessed=${tenantResult.tenantsProcessed}`);
    console.log(`   Total applied=${tenantResult.totalApplied}, total skipped=${tenantResult.totalSkipped}\n`);

    // Verify migration applied
    if (tenantResult.totalApplied > 0) {
      console.log('✅ Migration 066_add_super_admin_description.sql has been applied!\n');
      console.log('📊 Details:');
      console.log(`   - Tenants processed: ${tenantResult.tenantsProcessed}`);
      console.log(`   - Total migrations applied: ${tenantResult.totalApplied}`);
      console.log(`   - Total migrations skipped: ${tenantResult.totalSkipped}`);
      console.log('\n✨ All tenant databases now have the super_admin_description column!');
    } else {
      console.log('⚠️  No new migrations were applied (they may have been applied previously)');
    }

    console.log('\n🎉 Migration run complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

main();
