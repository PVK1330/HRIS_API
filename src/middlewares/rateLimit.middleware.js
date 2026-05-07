'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const isDevelopment = env.NODE_ENV !== 'production';

// General API rate limit
const generalLimiter = rateLimit({
  windowMs,
  max: isDevelopment ? Math.max(parseInt(env.RATE_LIMIT_MAX, 10) || 100, 1000) : (parseInt(env.RATE_LIMIT_MAX, 10) || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => isDevelopment,
});

// Strict limit for auth endpoints (login, register)
const authLimiter = rateLimit({
  windowMs,
  max: parseInt(env.AUTH_RATE_LIMIT_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Try again later.' },
  skipSuccessfulRequests: true,
});

// Very strict for public registration
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Try again in 1 hour.' },
});

module.exports = { generalLimiter, authLimiter, registrationLimiter };
