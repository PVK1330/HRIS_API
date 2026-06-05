'use strict';

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const ISSUER = process.env.MFA_ISSUER || 'HRIS';

/**
 * Per-user MFA is stored on whichever table represents the caller's identity:
 *   • organization admins  → admin_users (keyed by the JWT `id`)
 *   • everyone else (staff) → employees   (keyed by the JWT `employeeId`)
 * Both tables carry the same mfa_* columns (migrations 103 + 104).
 */
const IDENTITY = {
  admin: {
    table: 'admin_users',
    emailCol: 'email',
    nameCol: 'name',
    where: '',
  },
  employee: {
    table: 'employees',
    emailCol: 'work_email',
    nameCol: 'full_name',
    where: 'AND deleted_at IS NULL',
  },
};

/** Resolve the storage identity (table + id) from the authenticated user. */
function resolveIdentity(user) {
  if (!user || !user.db_name) {
    throw ApiError.badRequest('Tenant context missing for MFA operation');
  }
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') {
    if (!user.id) throw ApiError.badRequest('Could not resolve your admin account for MFA.');
    return { kind: 'admin', id: user.id, dbName: user.db_name };
  }
  // employees and all RBAC-based portal roles authenticate as `employee`
  if (!user.employeeId) {
    throw ApiError.badRequest('Your account is not linked to a profile, so MFA cannot be configured.');
  }
  return { kind: 'employee', id: user.employeeId, dbName: user.db_name };
}

async function loadRow(pool, cfg, id) {
  const { rows } = await pool.query(
    `SELECT id, ${cfg.emailCol} AS email, ${cfg.nameCol} AS name,
            mfa_enabled, mfa_secret, mfa_pending_secret
     FROM ${cfg.table} WHERE id = $1 ${cfg.where} LIMIT 1`,
    [id],
  );
  if (!rows[0]) throw ApiError.notFound('Account record not found');
  return rows[0];
}

/** Returns whether the current user has MFA enabled. */
async function getStatus(user) {
  const { kind, id, dbName } = resolveIdentity(user);
  const cfg = IDENTITY[kind];
  const pool = getTenantPool(dbName);
  const row = await loadRow(pool, cfg, id);
  return {
    enabled: Boolean(row.mfa_enabled),
    pending: Boolean(row.mfa_pending_secret) && !row.mfa_enabled,
  };
}

/**
 * Begins enrollment: generates a fresh secret, stores it as the pending secret,
 * and returns the otpauth URL + a QR code data URL to display.
 */
async function beginSetup(user) {
  const { kind, id, dbName } = resolveIdentity(user);
  const cfg = IDENTITY[kind];
  const pool = getTenantPool(dbName);
  const row = await loadRow(pool, cfg, id);

  if (row.mfa_enabled) {
    throw ApiError.badRequest('Two-factor authentication is already enabled. Disable it first to re-enroll.');
  }

  const accountLabel = row.email || row.name || `${cfg.table}-${row.id}`;
  const secret = speakeasy.generateSecret({
    name: `${ISSUER} (${accountLabel})`,
    issuer: ISSUER,
    length: 20,
  });

  await pool.query(
    `UPDATE ${cfg.table} SET mfa_pending_secret = $1 WHERE id = $2`,
    [secret.base32, row.id],
  );

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  return {
    secret: secret.base32, // shown so users can enter it manually if they can't scan
    otpauthUrl: secret.otpauth_url,
    qrDataUrl,
  };
}

/** Confirms enrollment by verifying a code against the pending secret. */
async function enable(user, code) {
  const { kind, id, dbName } = resolveIdentity(user);
  const cfg = IDENTITY[kind];
  if (!code) throw ApiError.badRequest('Verification code is required');

  const pool = getTenantPool(dbName);
  const row = await loadRow(pool, cfg, id);

  if (row.mfa_enabled) {
    throw ApiError.badRequest('Two-factor authentication is already enabled.');
  }
  if (!row.mfa_pending_secret) {
    throw ApiError.badRequest('Start the setup first, then enter the code from your authenticator app.');
  }

  const ok = speakeasy.totp.verify({
    secret: row.mfa_pending_secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!ok) {
    throw ApiError.unauthorized('Invalid verification code. Make sure your device time is correct and try again.');
  }

  await pool.query(
    `UPDATE ${cfg.table}
       SET mfa_secret = mfa_pending_secret,
           mfa_pending_secret = NULL,
           mfa_enabled = true,
           mfa_enrolled_at = NOW()
     WHERE id = $1`,
    [row.id],
  );

  return { enabled: true };
}

/** Disables MFA after verifying a current code (proves the user still controls the device). */
async function disable(user, code) {
  const { kind, id, dbName } = resolveIdentity(user);
  const cfg = IDENTITY[kind];

  const pool = getTenantPool(dbName);
  const row = await loadRow(pool, cfg, id);

  if (!row.mfa_enabled) {
    await pool.query(
      `UPDATE ${cfg.table} SET mfa_pending_secret = NULL WHERE id = $1`,
      [row.id],
    );
    return { enabled: false };
  }

  if (!code) throw ApiError.badRequest('Enter a current code from your authenticator app to disable MFA.');

  const ok = speakeasy.totp.verify({
    secret: row.mfa_secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!ok) throw ApiError.unauthorized('Invalid verification code.');

  await pool.query(
    `UPDATE ${cfg.table}
       SET mfa_secret = NULL,
           mfa_pending_secret = NULL,
           mfa_enabled = false,
           mfa_enrolled_at = NULL
     WHERE id = $1`,
    [row.id],
  );

  return { enabled: false };
}

module.exports = {
  getStatus,
  beginSetup,
  enable,
  disable,
};
