'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repository = require('./passwordSecurity.repository');

const VALID_RECOVERY_OPTIONS = ['Email recovery', 'Admin reset', 'Both'];

const SNAKE_KEYS = [
  'minimum_length',
  'must_include_special_chars',
  'password_expiry_days',
  'two_factor_auth',
  'auto_logout_minutes',
  'max_login_attempt_limit',
  'blocked_account_recovery',
];

function mapToResponse(row) {
  if (!row) return null;
  return {
    passwordPolicy: {
      minimumLength: row.minimum_length,
      mustIncludeSpecialChars: row.must_include_special_chars,
      passwordExpiryDays: row.password_expiry_days,
      twoFactorAuth: row.two_factor_auth,
    },
    accountSecurity: {
      autoLogoutMinutes: row.auto_logout_minutes,
      maxLoginAttemptLimit: row.max_login_attempt_limit,
      blockedAccountRecovery: row.blocked_account_recovery,
    },
    updatedAt: row.updated_at,
  };
}

function assertIntOptional(name, v, min, max) {
  if (v === undefined || v === null) return;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, `${name} must be an integer between ${min} and ${max}`);
  }
}

function assertBoolOptional(name, v) {
  if (v === undefined || v === null) return;
  if (typeof v !== 'boolean') {
    throw new ApiError(400, `${name} must be a boolean`);
  }
}

function assertRecoveryOptional(v) {
  if (v === undefined || v === null) return;
  if (!VALID_RECOVERY_OPTIONS.includes(v)) {
    throw new ApiError(
      400,
      `blocked_account_recovery must be one of: ${VALID_RECOVERY_OPTIONS.join(', ')}`
    );
  }
}

/**
 * Normalize nested camelCase payloads (passwordPolicy / accountSecurity) onto snake_case patch keys.
 */
function mergePasswordSecurityFlat(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};

  const copySnakeTop = () => {
    for (const k of SNAKE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) {
        out[k] = body[k];
      }
    }
  };

  copySnakeTop();

  const pp = body.passwordPolicy;
  if (pp && typeof pp === 'object') {
    if (pp.minimumLength !== undefined) out.minimum_length = pp.minimumLength;
    if (pp.mustIncludeSpecialChars !== undefined) {
      out.must_include_special_chars = pp.mustIncludeSpecialChars;
    }
    if (pp.passwordExpiryDays !== undefined) out.password_expiry_days = pp.passwordExpiryDays;
    if (pp.twoFactorAuth !== undefined) out.two_factor_auth = pp.twoFactorAuth;
  }

  const ac = body.accountSecurity;
  if (ac && typeof ac === 'object') {
    if (ac.autoLogoutMinutes !== undefined) out.auto_logout_minutes = ac.autoLogoutMinutes;
    if (ac.maxLoginAttemptLimit !== undefined) {
      out.max_login_attempt_limit = ac.maxLoginAttemptLimit;
    }
    if (ac.blockedAccountRecovery !== undefined) {
      out.blocked_account_recovery = ac.blockedAccountRecovery;
    }
  }

  return out;
}

function validatePatch(fields) {
  assertIntOptional('minimum_length', fields.minimum_length, 6, 32);
  assertIntOptional('password_expiry_days', fields.password_expiry_days, 1, 365);
  assertIntOptional('auto_logout_minutes', fields.auto_logout_minutes, 5, 480);
  assertIntOptional('max_login_attempt_limit', fields.max_login_attempt_limit, 1, 20);

  assertBoolOptional('must_include_special_chars', fields.must_include_special_chars);
  assertBoolOptional('two_factor_auth', fields.two_factor_auth);

  assertRecoveryOptional(fields.blocked_account_recovery);
}

async function getPasswordSecuritySettings(dbName) {
  const pool = getTenantPool(dbName);
  let row = await repository.getSettings(pool);
  if (!row) {
    row = await repository.seedDefault(pool);
  }
  return mapToResponse(row);
}

async function updatePasswordSecuritySettings(dbName, body) {
  const flat = mergePasswordSecurityFlat(body);
  validatePatch(flat);

  const pool = getTenantPool(dbName);
  let row = await repository.updateSettings(pool, flat);
  if (!row) {
    await repository.seedDefault(pool);
    row = await repository.updateSettings(pool, flat);
  }
  if (!row) {
    throw new ApiError(500, 'Failed to update password security settings');
  }
  return mapToResponse(row);
}

module.exports = {
  VALID_RECOVERY_OPTIONS,
  getPasswordSecuritySettings,
  updatePasswordSecuritySettings,
  mergePasswordSecurityFlat,
};
