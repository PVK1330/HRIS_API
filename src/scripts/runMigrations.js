'use strict';

/**
 * SuperAdmin migrations runner.
 *
 * Runs every *.sql file in src/migrations/superadmin/ in lexicographic order
 * (001_, 002_, ...). Tracks applied filenames in public.schema_migrations so
 * that already-applied files are skipped on subsequent runs.
 *
 * Can be invoked two ways:
 *   1. As a CLI:   `node src/scripts/runMigrations.js`
 *   2. From code:  `await require('./scripts/runMigrations').runSuperAdminMigrations()`
 *      (the server invokes this at startup)
 */

const fs = require('fs');
const path = require('path');

const db = require('../config/db');
const logger = require('../utils/logger');

const SUPERADMIN_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'superadmin');

const TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function ensureTrackingTable(client) {
  await client.query(TRACKING_TABLE_SQL);
}

async function getAppliedFiles(client) {
  const { rows } = await client.query(
    'SELECT filename FROM public.schema_migrations ORDER BY filename ASC'
  );
  return new Set(rows.map((r) => r.filename));
}

async function recordApplied(client, filename) {
  await client.query(
    'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
    [filename]
  );
}

async function runSuperAdminMigrations() {
  if (!fs.existsSync(SUPERADMIN_MIGRATIONS_DIR)) {
    throw new Error(
      `SuperAdmin migrations directory not found: ${SUPERADMIN_MIGRATIONS_DIR}`
    );
  }

  const files = fs
    .readdirSync(SUPERADMIN_MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.warn('No SuperAdmin migration files found.');
    return { applied: 0, skipped: 0 };
  }

  const client = await db.pool.connect();
  let applied = 0;
  let skipped = 0;

  try {
    await ensureTrackingTable(client);
    const alreadyApplied = await getAppliedFiles(client);

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        skipped += 1;
        logger.debug(`[migrate] skip (already applied): ${file}`);
        continue;
      }

      const sqlPath = path.join(SUPERADMIN_MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      logger.info(`[migrate] applying: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await recordApplied(client, file);
        await client.query('COMMIT');
        applied += 1;
        logger.debug(`[migrate] done:     ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`[migrate] FAILED:   ${file}`, err.message);
        throw err;
      }
    }

    logger.debug(`[migrate] superadmin migrations complete (applied=${applied}, skipped=${skipped})`);
    return { applied, skipped };
  } finally {
    client.release();
  }
}

// CLI entrypoint
if (require.main === module) {
  (async () => {
    try {
      await db.assertDbConnection();
      await runSuperAdminMigrations();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('Migration run failed', err);
      try { await db.pool.end(); } catch (_) {}
      process.exit(1);
    }
  })();
}

module.exports = { runSuperAdminMigrations };
