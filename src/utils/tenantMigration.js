'use strict';

const logger = require('./logger');
const ApiError = require('./ApiError');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');

// Single server-wide cache: concurrent callers for the same dbName share one promise.
const _cache = new Map();

/**
 * Ensures tenant migrations have run for `dbName`, exactly once per server lifetime.
 * On failure: evicts the cache entry so the next request can retry, logs at error
 * level, and throws ApiError.internal so internal Postgres details never reach callers.
 */
async function ensureMigrated(dbName) {
  if (!dbName) return;
  if (_cache.has(dbName)) return _cache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _cache.delete(dbName);
    logger.error('[tenantMigration] auto-migration failed', { db: dbName, err: err.message });
    throw ApiError.internal('Database setup failed.');
  });
  _cache.set(dbName, p);
  return p;
}

module.exports = { ensureMigrated };
