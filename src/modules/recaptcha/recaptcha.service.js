'use strict';

const axios = require('axios');

const ApiError = require('../../utils/ApiError');
const repo = require('./recaptcha.repository');

const MASKED = '••••••••';
const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

function rowToApi(row) {
  if (!row) return null;
  return {
    isEnabled: !!row.is_enabled,
    siteKey: row.site_key || '',
    // Mask the stored secret on every read.
    secretKey: row.secret_key ? MASKED : '',
    lastVerifiedAt: row.last_verified_at,
    lastVerifiedStatus: row.last_verified_status || 'untested',
    updatedAt: row.updated_at,
  };
}

async function getRecaptcha() {
  const row = await repo.findSingleton();
  if (!row) {
    return {
      isEnabled: false,
      siteKey: '',
      secretKey: '',
      lastVerifiedAt: null,
      lastVerifiedStatus: 'untested',
      updatedAt: null,
    };
  }
  return rowToApi(row);
}

/**
 * Update settings. If the client sends back the masked secret, we keep
 * the existing stored value rather than overwriting it.
 */
async function updateRecaptcha(input = {}) {
  const patch = {
    isEnabled: input.isEnabled,
    siteKey:   input.siteKey,
    secretKey: input.secretKey,
  };

  // Drop masked secret so existing value is preserved.
  if (patch.secretKey === MASKED) {
    delete patch.secretKey;
  }
  if (patch.siteKey !== undefined && patch.siteKey !== null) {
    patch.siteKey = String(patch.siteKey);
  }
  if (patch.secretKey !== undefined && patch.secretKey !== null) {
    patch.secretKey = String(patch.secretKey);
  }

  const row = await repo.upsertSingleton(patch);
  return rowToApi(row);
}

/**
 * Validate the configured secret key against Google's siteverify endpoint.
 * Even with a dummy token, Google returns either:
 *   - error-codes: ['invalid-input-response']  → secret is RECOGNIZED
 *   - error-codes: ['invalid-input-secret']    → secret is INVALID
 * That distinction is enough to tell whether the configured secret is real.
 */
async function testRecaptcha() {
  const row = await repo.findSingleton();
  if (!row || !row.secret_key) {
    return {
      verified: false,
      message: 'reCAPTCHA secret key is not configured',
      testedAt: new Date().toISOString(),
    };
  }

  if (row.secret_key.length < 30) {
    await repo.recordVerification('failed');
    return {
      verified: false,
      message: 'Secret key looks too short to be a valid reCAPTCHA v2 key',
      testedAt: new Date().toISOString(),
    };
  }

  let response;
  try {
    response = await axios.post(
      SITEVERIFY_URL,
      new URLSearchParams({
        secret: row.secret_key,
        response: 'dummy-test-token',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    await repo.recordVerification('failed');
    return {
      verified: false,
      message: err && err.message ? err.message : 'reCAPTCHA request failed',
      testedAt: new Date().toISOString(),
    };
  }

  const data = (response && response.data) || {};
  const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];

  if (codes.includes('invalid-input-secret')) {
    await repo.recordVerification('failed');
    return {
      verified: false,
      message: 'Invalid reCAPTCHA secret key',
      testedAt: new Date().toISOString(),
    };
  }

  // Any other error-code (most commonly invalid-input-response) means the
  // secret was accepted by Google — only the dummy token was bogus.
  await repo.recordVerification('success');
  return {
    verified: true,
    message: 'reCAPTCHA secret key is valid',
    testedAt: new Date().toISOString(),
  };
}

module.exports = {
  getRecaptcha,
  updateRecaptcha,
  testRecaptcha,
  MASKED,
};
