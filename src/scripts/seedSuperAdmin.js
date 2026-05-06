'use strict';

/**
 * One-time seed script that inserts a SuperAdmin row using SEED_SUPERADMIN_*
 * values from .env. Idempotent: skips if a SuperAdmin with that email already
 * exists. Never expose this as an HTTP endpoint.
 *
 * Usage:
 *   node src/scripts/seedSuperAdmin.js
 *   npm run seed:superadmin
 */

const bcrypt = require('bcrypt');

const env = require('../config/env');
const db = require('../config/db');
const logger = require('../utils/logger');
const repo = require('../modules/superadmin/superadmin.repository');
const { runSuperAdminMigrations } = require('./runMigrations');

const SALT_ROUNDS = 12;

async function seed() {
  const { email, password, name } = env.SEED;

  if (!email || !password || !name) {
    throw new Error(
      'Missing seed env vars. Please set SEED_SUPERADMIN_EMAIL, ' +
      'SEED_SUPERADMIN_PASSWORD, and SEED_SUPERADMIN_NAME in your .env file.'
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();

  // Make sure tables exist before we try to insert.
  await db.assertDbConnection();
  await runSuperAdminMigrations();

  const existing = await repo.findByEmail(normalizedEmail);
  if (existing) {
    logger.info(`[seed] SuperAdmin already exists for ${normalizedEmail} — skipping.`);
    return { skipped: true, id: existing.id };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const created = await repo.create({
    email: normalizedEmail,
    passwordHash,
    name: cleanName,
  });

  logger.info(`[seed] SuperAdmin created (id=${created.id}, email=${created.email})`);
  return { skipped: false, id: created.id };
}

if (require.main === module) {
  (async () => {
    try {
      await seed();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('[seed] failed', err);
      try { await db.pool.end(); } catch (_) {}
      process.exit(1);
    }
  })();
}

module.exports = { seed };
