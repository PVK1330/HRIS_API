'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');
const logger = require('../utils/logger');
const { createRedisClient, isEnabled: redisEnabled } = require('../config/redis');

// Horizontal scaling: the default express-rate-limit store is per-process MEMORY,
// so behind N instances each user effectively gets N× the limit and the counter
// resets on every deploy. When Redis is configured, back all limiters with a
// SHARED store so the limit is enforced cluster-wide. Falls back to memory when
// Redis is unset (dev/single-instance) or the optional packages aren't installed.
//
// Guarded require: rate-limit-redis is optional — never crash boot without it.
let RedisStore = null;
try {
  ({ RedisStore } = require('rate-limit-redis'));
} catch {
  RedisStore = null;
}

let _rlRedisClient; // one shared client for every limiter
function rateLimitRedisClient() {
  if (_rlRedisClient === undefined) _rlRedisClient = createRedisClient('ratelimit');
  return _rlRedisClient;
}

/**
 * Build a shared RedisStore for a limiter, or undefined to use the default
 * in-memory store. `prefix` keeps each limiter's buckets separate.
 */
function makeStore(prefix) {
  if (!redisEnabled() || !RedisStore) {
    if (redisEnabled() && !RedisStore) {
      logger.warn(
        "[ratelimit] REDIS_* set but 'rate-limit-redis' not installed — using in-memory store " +
        '(NOT shared across instances). Install for multi-instance: npm i rate-limit-redis',
      );
    }
    return undefined;
  }
  const client = rateLimitRedisClient();
  if (!client) return undefined;
  try {
    return new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: `rl:${prefix}:`,
    });
  } catch (err) {
    logger.error(`[ratelimit] failed to build Redis store (${prefix}); using memory: ${err.message}`);
    return undefined;
  }
}

// All limiter sizing comes from env.RATE_LIMIT (config/env.js parses the env
// vars and applies sane defaults). Nothing here should read a flat env name or
// hardcode a literal — that was the wiring bug that made .env overrides no-ops.
const {
  windowMs,
  max: generalMax,
  authMax,
  otpMax,
  registrationWindowMs,
  registrationMax,
  refreshMax,
  candidateWindowMs,
  candidateMax,
} = env.RATE_LIMIT;

// Set DISABLE_RATE_LIMIT=true in local .env only — never in staging or production
const isRateLimitDisabled = env.DISABLE_RATE_LIMIT === true;

// General API rate limit
const generalLimiter = rateLimit({
  windowMs,
  max: generalMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('general'),
  message: { success: false, message: 'Too many requests, please try again later.' },
  // Don't burn the budget on requests that aren't real API calls: CORS
  // preflight (OPTIONS) doubles every cross-origin request, the health probe is
  // polled by uptime checks, and static uploads (avatars/documents) can be
  // dozens of GETs per page. Counting these was a big source of false 429s.
  skip: (req) => {
    if (isRateLimitDisabled) return true;
    if (req.method === 'OPTIONS') return true;
    if (req.path === '/health') return true;
    if (req.path.startsWith('/uploads')) return true;
    return false;
  },
});

// Strict limit for auth endpoints (login, register)
const authLimiter = rateLimit({
  windowMs,
  max: authMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('auth'),
  message: { success: false, message: 'Too many authentication attempts. Try again later.' },
  skipSuccessfulRequests: true,
});

// OTP verification (forgot-password code check + reset-password).
// Unlike authLimiter, this counts EVERY attempt — including failed ones — so
// repeated wrong-code guesses are throttled (the whole point of OTP brute-force
// protection). Keyed per IP + email so a single client cannot hammer one
// account, and one account cannot be hammered from a single client. This sits
// alongside the per-record DB attempt counter (which invalidates the OTP after
// a handful of wrong guesses regardless of source IP).
const otpLimiter = rateLimit({
  windowMs,
  max: otpMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('otp'),
  message: { success: false, message: 'Too many attempts. Please try again later.' },
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
    const ipKey = ipKeyGenerator(req.ip);
    return email ? `otp:${ipKey}:${email}` : `otp:${ipKey}`;
  },
  skip: () => isRateLimitDisabled,
});

// Very strict for public tenant self-registration only
const registrationLimiter = rateLimit({
  windowMs: registrationWindowMs,
  max: registrationMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('registration'),
  message: { success: false, message: 'Too many registration attempts. Try again in 1 hour.' },
});

// Token refresh — generous enough for multi-tab usage but still throttled
const refreshLimiter = rateLimit({
  windowMs,
  max: refreshMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('refresh'),
  message: { success: false, message: 'Too many refresh attempts. Try again later.' },
});

/** Candidate offer/sign/documents portal — per token + IP, not registration limits. */
const candidateOnboardingLimiter = rateLimit({
  windowMs: candidateWindowMs,
  max: candidateMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('candidate'),
  message: {
    success: false,
    message: 'Too many requests. Please wait a moment and try again.',
  },
  keyGenerator: (req) => {
    const token = req.params?.token ? String(req.params.token).slice(0, 64) : '';
    const ipKey = ipKeyGenerator(req.ip);

    return token
      ? `onboarding:${token}:${ipKey}`
      : `onboarding:${ipKey}`;
  },
});
/**
 * Performance-module limiter.
 * GET requests are read-heavy but still bounded: 300 / 15 min.
 * Mutating requests (POST / PUT / PATCH / DELETE) are tighter: 100 / 15 min.
 * Key = tenant db_name + user id + client IP so a shared NAT doesn't throttle
 * an entire office, and one user can't starve another on the same tenant.
 */
const perfGetLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.PERF_GET_RATE_LIMIT_MAX, 10) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('perf-get'),
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const tenant = req.user?.db_name ? String(req.user.db_name).slice(0, 80) : 'anon';
    const userId = req.user?.id ? String(req.user.id) : 'guest';
    const ipKey = ipKeyGenerator(req.ip);
    return `perf-get:${tenant}:${userId}:${ipKey}`;
  },
  skip: () => isRateLimitDisabled,
});

const perfWriteLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.PERF_WRITE_RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('perf-write'),
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const tenant = req.user?.db_name ? String(req.user.db_name).slice(0, 80) : 'anon';
    const userId = req.user?.id ? String(req.user.id) : 'guest';
    const ipKey = ipKeyGenerator(req.ip);
    return `perf-write:${tenant}:${userId}:${ipKey}`;
  },
  skip: () => isRateLimitDisabled,
});

/**
 * Single middleware that delegates to the correct limiter based on HTTP method.
 * Attach this to any performance router before business handlers.
 */
function performanceLimiter(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return perfGetLimiter(req, res, next);
  }
  return perfWriteLimiter(req, res, next);
}

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  refreshLimiter,
  registrationLimiter,
  candidateOnboardingLimiter,
  performanceLimiter,
};
