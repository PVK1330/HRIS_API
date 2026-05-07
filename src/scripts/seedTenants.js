'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../utils/logger');
const env = require('../config/env');
const { runSuperAdminMigrations } = require('./runMigrations');
const tenantService = require('../modules/tenant/tenant.service');

const SALT_ROUNDS = 12;

async function seedTenants() {
  const tenants = [
    {
      name: 'Acme Corp',
      admin_email: 'admin@acme.com',
      admin_name: 'Wile E. Coyote',
      company_name: 'Acme Corporation',
      plan_id: 'pro',
      timezone: 'UTC',
    }
  ];

  await db.assertDbConnection();
  await runSuperAdminMigrations();

  for (const t of tenants) {
    const existing = await db.query('SELECT id FROM public.tenants WHERE admin_email = $1', [t.admin_email]);
    if (existing.rows.length > 0) {
      logger.info(`[seed:tenants] Tenant ${t.admin_email} already exists — skipping.`);
      continue;
    }

    await tenantService.createTenant({
      name: t.name,
      adminEmail: t.admin_email,
      adminName: t.admin_name,
      adminPassword: 'admin@acme.com',
      createdBy: 1 // Root SuperAdmin
    });

    logger.info(`[seed:tenants] Tenant created successfully: ${t.admin_email} (Database created)`);
  }
}

if (require.main === module) {
  (async () => {
    try {
      await seedTenants();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('[seed:tenants] failed', err);
      try { await db.pool.end(); } catch (_) { }
      process.exit(1);
    }
  })();
}

module.exports = { seedTenants };
