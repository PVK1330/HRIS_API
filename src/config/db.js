"use strict";

const { Pool } = require("pg");
const env = require("./env");
const logger = require("../utils/logger");

const superAdminPool = new Pool({
  user: env.DB.user,
  password: env.DB.password,
  database: env.DB.database,
  host: env.DB.host,
  port: env.DB.port,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

superAdminPool.on("error", (err) => {
  logger.error("Unexpected SuperAdmin PG pool error", err);
});

/**
 * Tenant pool cache. One pg.Pool per tenant database, keyed by db_name.
 * Pools are reused across requests so we don't pay TCP/auth cost every time.
 */
const tenantPools = new Map();

/**
 * Returns a pg.Pool connected to the given tenant database.
 * Uses the same DB credentials/host/port as superAdminPool — only the
 * database name changes.
 *
 * @param {string} databaseName  e.g. "tenant_ab12_cd34_..."
 * @returns {Pool}
 */
function getTenantPool(databaseName) {
  if (!databaseName || typeof databaseName !== "string") {
    throw new Error("getTenantPool: databaseName is required");
  }

  const cached = tenantPools.get(databaseName);
  if (cached) return cached;

  const pool = new Pool({
    user: env.DB.user,
    password: env.DB.password,
    database: databaseName,
    host: env.DB.host,
    port: env.DB.port,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });

  pool.on("error", (err) => {
    logger.error(`Unexpected tenant PG pool error (db=${databaseName})`, err);
  });

  tenantPools.set(databaseName, pool);
  logger.info(`[db] created tenant pool for ${databaseName}`);
  return pool;
}

/**
 * Closes and removes a single tenant pool from the cache.
 * Required before DROP DATABASE so PG can release its connections.
 */
async function closeTenantPool(databaseName) {
  const pool = tenantPools.get(databaseName);
  if (!pool) return;
  tenantPools.delete(databaseName);
  try {
    await pool.end();
  } catch (err) {
    logger.error(`Error closing tenant pool (db=${databaseName})`, err.message);
  }
}

/**
 * Closes every tenant pool. Useful during graceful shutdown.
 */
async function closeAllTenantPools() {
  const entries = [...tenantPools.entries()];
  tenantPools.clear();
  await Promise.all(
    entries.map(async ([name, p]) => {
      try {
        await p.end();
      } catch (err) {
        logger.error(`Error closing tenant pool (db=${name})`, err.message);
      }
    }),
  );
}

/**
 * Verifies SuperAdmin DB connectivity. Throws on failure.
 */
async function assertDbConnection() {
  const client = await superAdminPool.connect();
  try {
    await client.query("SELECT 1");
    logger.info(
      `Database connected: ${env.DB.database}@${env.DB.host}:${env.DB.port}`,
    );
  } finally {
    client.release();
  }
}

/**
 * Convenience wrapper for SuperAdmin pool queries.
 */
function query(text, params) {
  return superAdminPool.query(text, params);
}

/**
 * Run statements inside a single transaction on the SuperAdmin pool.
 */
async function withTransaction(fn) {
  const client = await superAdminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // ignore rollback failures, original error is propagated
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  superAdminPool,
  // Backward-compat alias so existing code using db.pool keeps working.
  pool: superAdminPool,
  query,
  withTransaction,
  assertDbConnection,
  getTenantPool,
  closeTenantPool,
  closeAllTenantPools,
};
