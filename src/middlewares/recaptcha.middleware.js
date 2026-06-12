'use strict';

/**
 * reCAPTCHA v2 enforcement middleware.
 *
 * When reCAPTCHA is enabled in public.recaptcha_settings, every request must
 * include a valid `recaptchaToken` (or `g-recaptcha-response`) in the body.
 * The token is verified against Google's siteverify endpoint using the stored
 * secret key. When reCAPTCHA is disabled the middleware is a transparent no-op.
 *
 * Usage:
 *   router.post('/login', authLimiter, verifyRecaptcha, [...validators], validate, controller.login);
 */

const axios = require('axios');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Fetch the singleton reCAPTCHA settings row.
 * Returns null when the table doesn't exist yet (pre-migration environments).
 */
async function getRecaptchaSettings() {
  try {
    const repo = require('../modules/recaptcha/recaptcha.repository');
    return repo.findSingleton();
  } catch (err) {
    logger.debug(`[recaptcha] settings lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * Express middleware — enforces reCAPTCHA when enabled, no-ops when disabled.
 */
async function verifyRecaptcha(req, res, next) {
  let settings;
  try {
    settings = await getRecaptchaSettings();
  } catch (err) {
    // If we can't read settings, fail open (don't break auth for a settings lookup error).
    logger.warn(`[recaptcha] middleware: settings lookup error, skipping: ${err.message}`);
    return next();
  }

  // reCAPTCHA disabled or not configured → pass through.
  if (!settings || !settings.is_enabled || !settings.secret_key) {
    return next();
  }

  const token =
    (req.body && (req.body.recaptchaToken || req.body['g-recaptcha-response'])) || null;

  if (!token) {
    return next(new ApiError(400, 'reCAPTCHA token is required'));
  }

  let response;
  try {
    response = await axios.post(
      SITEVERIFY_URL,
      new URLSearchParams({ secret: settings.secret_key, response: token }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8_000,
        validateStatus: () => true,
      },
    );
  } catch (err) {
    logger.error(`[recaptcha] siteverify request failed: ${err.message}`);
    return next(new ApiError(503, 'reCAPTCHA verification service unavailable'));
  }

  const data = (response && response.data) || {};

  if (!data.success) {
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].join(', ') : 'unknown';
    logger.warn(`[recaptcha] verification failed: ${codes}`);
    return next(new ApiError(400, 'reCAPTCHA verification failed. Please try again.'));
  }

  return next();
}

module.exports = { verifyRecaptcha };
