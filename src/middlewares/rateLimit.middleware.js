'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
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

// Very strict for public tenant self-registration only
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Try again in 1 hour.' },
});

/** Candidate offer/sign/documents portal — per token + IP, not registration limits. */
const candidateOnboardingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 500 : 150,
  standardHeaders: true,
  legacyHeaders: false,
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
module.exports = {
  generalLimiter,
  authLimiter,
  registrationLimiter,
  candidateOnboardingLimiter,
};
