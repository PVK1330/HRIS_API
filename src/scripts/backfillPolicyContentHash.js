'use strict';

/**
 * One-time backfill of policies.content_hash for rows that predate the column
 * (content_hash IS NULL), across every active tenant DB.
 *
 * WHY THIS IS A SCRIPT, NOT A .sql MIGRATION:
 * content_hash is a SHA-256 of the canonicalized policy BODY computed in JS
 * (see policies.repository.computeContentHash). The migration runner only
 * executes .sql files (runMigrations.js), and SQL cannot reproduce that exact
 * canonicalization byte-for-byte. So the backfill must run in Node and reuse the
 * SAME hash function — which this script does.
 *
 * SAFETY: only fills NULL/empty baselines; never overwrites an existing hash.
 * The runtime additionally guards first-deploy re-acknowledgement (update() treats
 * a NULL baseline as "establish, don't bump"), so running this is a belt-and-
 * suspenders step that also makes genuine material-change detection accurate from
 * the very first edit.
 *
 * Usage:
 *   node src/scripts/backfillPolicyContentHash.js            # apply
 *   node src/scripts/backfillPolicyContentHash.js --dry-run  # report only
 */

const db = require('../config/db');
const logger = require('../utils/logger');
const { getTenantPool, superAdminPool } = db;
const { computeContentHash } = require('../modules/policies/policies.repository');
const { parseSections, parseAttachments } = require('../modules/policies/policies.normalize');

async function backfillTenant(dbName, { dryRun }) {
  const pool = await getTenantPool(dbName);
  const { rows } = await pool.query(
    `SELECT id, content, attachments, file_url
       FROM policies
      WHERE content_hash IS NULL OR content_hash = ''`,
  );

  let updated = 0;
  for (const r of rows) {
    const hash = computeContentHash({
      sections: parseSections(r.content),
      attachments: parseAttachments(r.attachments),
      fileUrl: r.file_url,
    });
    if (!dryRun) {
      await pool.query('UPDATE policies SET content_hash = $1 WHERE id = $2', [hash, r.id]);
    }
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function run({ dryRun = false } = {}) {
  await db.assertDbConnection();
  const { rows: tenants } = await superAdminPool.query(
    `SELECT db_name FROM public.tenants WHERE status = 'active'`,
  );

  const totals = { tenants: 0, scanned: 0, updated: 0 };
  for (const t of tenants) {
    try {
      const res = await backfillTenant(t.db_name, { dryRun });
      totals.tenants += 1;
      totals.scanned += res.scanned;
      totals.updated += res.updated;
      logger.info(
        `[backfillPolicyContentHash] ${t.db_name}: scanned=${res.scanned} updated=${res.updated}${dryRun ? ' (dry-run)' : ''}`,
      );
    } catch (e) {
      logger.error(`[backfillPolicyContentHash] ${t.db_name} failed: ${e.message}`);
    }
  }
  return totals;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun })
    .then(async (t) => {
      logger.info(
        `[backfillPolicyContentHash] done — tenants=${t.tenants} scanned=${t.scanned} updated=${t.updated}${dryRun ? ' (dry-run)' : ''}`,
      );
      try { await db.closeAllTenantPools(); await db.pool.end(); } catch (_) { /* ignore */ }
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error('[backfillPolicyContentHash] fatal', e);
      try { await db.pool.end(); } catch (_) { /* ignore */ }
      process.exit(1);
    });
}

module.exports = { run, backfillTenant };
