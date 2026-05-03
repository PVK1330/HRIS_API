"use strict";

const { Pool } = require("pg");
const env = require("./env");
const logger = require("../utils/logger");

const pool = new Pool({
  user: env.DB.user,
  password: env.DB.password,
  database: env.DB.database,
  host: env.DB.host,
  port: env.DB.port,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  logger.error("Unexpected PG pool error", err);
});

async function assertDbConnection() {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    logger.info(
      `Database connected: ${env.DB.database}@${env.DB.host}:${env.DB.port}`,
    );
  } finally {
    client.release();
  }
}

function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
  assertDbConnection,
};
