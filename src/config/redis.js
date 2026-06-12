'use strict';

const logger = require('../utils/logger');
const env = require('./env');

/**
 * Shared Redis connectivity for HORIZONTAL SCALING. Two consumers:
 *   - the Socket.IO adapter (cross-instance message/presence fan-out), and
 *   - the express-rate-limit store (one shared counter across instances).
 *
 * Both degrade gracefully: if Redis isn't configured (REDIS_URL / REDIS_HOST
 * unset) OR the optional `ioredis` package isn't installed, createRedisClient()
 * returns null and callers fall back to their in-memory behaviour — which is the
 * correct, working setup for single-instance / local dev.
 */

// Lazy, guarded require so the app boots fine when `ioredis` isn't installed.
let _ioredis;
function loadIoredis() {
  if (_ioredis !== undefined) return _ioredis;
  try {
    _ioredis = require('ioredis');
  } catch {
    _ioredis = null;
  }
  return _ioredis;
}

/** True only when Redis connection details are configured via env. */
function isEnabled() {
  return !!(env.REDIS.url || env.REDIS.host);
}

function buildOptions() {
  const { url, host, port, password, db, tls, keyPrefix } = env.REDIS;
  if (url) return url; // ioredis accepts a redis[s]:// URL string directly
  return {
    host,
    port,
    password: password || undefined,
    db,
    keyPrefix,
    tls: tls ? {} : undefined,
    // Fail fast rather than letting a flaky Redis wedge requests/sockets.
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
}

/**
 * Create a FRESH ioredis client, or null if Redis is disabled/unavailable.
 * Each call returns its own connection — the Socket.IO adapter needs a dedicated
 * pub + sub pair, separate from the rate-limiter's client.
 *
 * @param {string} label  short tag used in log lines (e.g. 'ratelimit', 'socket-pub')
 */
function createRedisClient(label = 'redis') {
  if (!isEnabled()) return null;

  const Redis = loadIoredis();
  if (!Redis) {
    logger.warn(
      `[redis] REDIS_* is configured but the 'ioredis' package is not installed — ` +
      `${label} is falling back to in-memory. Install it for multi-instance: npm i ioredis`,
    );
    return null;
  }

  try {
    const client = new Redis(buildOptions());
    client.on('error', (err) => logger.error(`[redis:${label}] ${err.message}`));
    client.on('connect', () => logger.info(`[redis:${label}] connected`));
    return client;
  } catch (err) {
    logger.error(`[redis] failed to create ${label} client: ${err.message}`);
    return null;
  }
}

module.exports = { isEnabled, createRedisClient };
