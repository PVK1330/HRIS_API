'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

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
  message: { success: false, message: 'Too many registration attempts. Try again in 1 hour.' },
});

// Token refresh — generous enough for multi-tab usage but still throttled
const refreshLimiter = rateLimit({
  windowMs,
  max: refreshMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many refresh attempts. Try again later.' },
});

/** Candidate offer/sign/documents portal — per token + IP, not registration limits. */
const candidateOnboardingLimiter = rateLimit({
  windowMs: candidateWindowMs,
  max: candidateMax,
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
  otpLimiter,
  refreshLimiter,
  registrationLimiter,
  candidateOnboardingLimiter,
};
