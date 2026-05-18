'use strict';

const ApiError = require('../../utils/ApiError');
const repo = require('./paymentGateways.repository');

const stripeVerifier   = require('../../helpers/gatewayVerifier/stripeVerifier');
const paypalVerifier   = require('../../helpers/gatewayVerifier/paypalVerifier');
const razorpayVerifier = require('../../helpers/gatewayVerifier/razorpayVerifier');
const offlineVerifier  = require('../../helpers/gatewayVerifier/offlineVerifier');

/**
 * Payment Gateways — business logic.
 *
 * Sensitive credential fields are masked with •••••••• on every read; on
 * update, masked values are dropped so the stored secret is preserved.
 */

const MASKED = '••••••••';

const SENSITIVE_FIELDS = {
  stripe:   ['secret_key', 'webhook_secret'],
  paypal:   ['client_secret'],
  razorpay: ['key_secret', 'webhook_secret'],
  offline:  [],
};

const VERIFIERS = {
  stripe:   stripeVerifier,
  paypal:   paypalVerifier,
  razorpay: razorpayVerifier,
  offline:  offlineVerifier,
};

const VALID_SLUGS = Object.keys(SENSITIVE_FIELDS);

function assertValidSlug(slug) {
  if (!VALID_SLUGS.includes(slug)) {
    throw new ApiError(400, `Unknown gateway: ${slug}`);
  }
}

function maskCredentials(slug, credentials) {
  const out = { ...(credentials || {}) };
  for (const field of SENSITIVE_FIELDS[slug] || []) {
    if (out[field] && String(out[field]).length > 0) {
      out[field] = MASKED;
    }
  }
  return out;
}

/** Normalize a DB row into the API response shape (snake_case credentials, masked). */
function rowToApi(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    isEnabled: !!row.is_enabled,
    testMode: !!row.test_mode,
    credentials: maskCredentials(row.slug, row.credentials || {}),
    lastVerifiedAt: row.last_verified_at,
    lastVerifiedStatus: row.last_verified_status || 'untested',
    updatedAt: row.updated_at,
  };
}

async function getAllGateways() {
  const rows = await repo.findAll();
  return rows.map(rowToApi);
}

/** Public list for onboarding UIs — enabled gateways only, no credentials. */
async function listEnabledGateways() {
  const rows = await repo.findAll();
  return rows
    .filter((r) => r.is_enabled)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      testMode: !!r.test_mode,
    }));
}

async function getGatewayBySlug(slug) {
  assertValidSlug(slug);
  const row = await repo.findBySlug(slug);
  if (!row) throw new ApiError(404, `Gateway not found: ${slug}`);
  return rowToApi(row);
}

/**
 * Update a gateway. Sensitive credentials submitted as •••••••• are dropped
 * (so we keep the existing stored value). Non-sensitive fields are merged
 * into the JSONB credentials blob.
 */
async function updateGateway(slug, payload = {}) {
  assertValidSlug(slug);

  const existing = await repo.findBySlug(slug);
  if (!existing) throw new ApiError(404, `Gateway not found: ${slug}`);

  const incomingCreds = payload.credentials && typeof payload.credentials === 'object'
    ? { ...payload.credentials }
    : null;

  let mergedCreds;
  if (incomingCreds) {
    // Strip masked sensitive fields — keep whatever is currently in DB.
    for (const field of SENSITIVE_FIELDS[slug] || []) {
      if (incomingCreds[field] === MASKED) {
        delete incomingCreds[field];
      }
    }
    mergedCreds = { ...(existing.credentials || {}), ...incomingCreds };
  }

  const updated = await repo.updateBySlug(slug, {
    isEnabled:   payload.isEnabled,
    testMode:    payload.testMode,
    credentials: mergedCreds,
  });

  if (!updated) throw new ApiError(404, `Gateway not found: ${slug}`);
  return rowToApi(updated);
}

/**
 * Live connectivity test. Pulls REAL (unmasked) credentials from the DB and
 * delegates to the matching verifier helper. Persists the outcome in
 * last_verified_at / last_verified_status regardless of result.
 */
async function testGateway(slug) {
  assertValidSlug(slug);

  const row = await repo.findBySlug(slug);
  if (!row) throw new ApiError(404, `Gateway not found: ${slug}`);

  const verifier = VERIFIERS[slug];
  if (!verifier || typeof verifier.verify !== 'function') {
    throw new ApiError(500, `No verifier implemented for gateway: ${slug}`);
  }

  const credentials = row.credentials || {};
  const testMode = !!row.test_mode;

  let result;
  try {
    result = await verifier.verify(credentials, { testMode });
  } catch (err) {
    // Defensive — verifiers should not throw, but if one does we still record
    // a failed verification rather than letting a 500 bubble.
    result = {
      success: false,
      message: err && err.message ? err.message : 'Verification failed',
    };
  }

  const status = result && result.success ? 'success' : 'failed';
  await repo.recordVerification(slug, status);

  return {
    verified: !!(result && result.success),
    message: (result && result.message) || (status === 'success' ? 'OK' : 'Verification failed'),
    testedAt: new Date().toISOString(),
  };
}

module.exports = {
  getAllGateways,
  listEnabledGateways,
  getGatewayBySlug,
  updateGateway,
  testGateway,
  // exported for tests / route validation
  VALID_SLUGS,
  SENSITIVE_FIELDS,
  MASKED,
};
