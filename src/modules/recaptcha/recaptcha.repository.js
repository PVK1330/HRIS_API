'use strict';

const db = require('../../config/db');

/**
 * Repository for the singleton public.recaptcha_settings row.
 * The migration seeds exactly one row; we always read/update that row.
 */

const BASE_SELECT = `
  SELECT
    id,
    is_enabled,
    site_key,
    secret_key,
    last_verified_at,
    last_verified_status,
    created_at,
    updated_at
  FROM public.recaptcha_settings
  ORDER BY created_at ASC
  LIMIT 1
`;

async function findSingleton() {
  const { rows } = await db.query(BASE_SELECT);
  return rows[0] || null;
}

/**
 * Update the singleton row. Any missing field is left untouched.
 * Creates the row if for some reason it doesn't exist yet.
 */
async function upsertSingleton({ isEnabled, siteKey, secretKey }) {
  const existing = await findSingleton();

  if (!existing) {
    const insertSql = `
      INSERT INTO public.recaptcha_settings (is_enabled, site_key, secret_key)
      VALUES ($1, $2, $3)
      RETURNING
        id, is_enabled, site_key, secret_key,
        last_verified_at, last_verified_status, created_at, updated_at
    `;
    const { rows } = await db.query(insertSql, [
      isEnabled === undefined ? false : !!isEnabled,
      siteKey   === undefined ? '' : String(siteKey),
      secretKey === undefined ? '' : String(secretKey),
    ]);
    return rows[0];
  }

  const updateSql = `
    UPDATE public.recaptcha_settings
       SET is_enabled = COALESCE($1, is_enabled),
           site_key   = COALESCE($2, site_key),
           secret_key = COALESCE($3, secret_key),
           updated_at = NOW()
     WHERE id = $4
    RETURNING
      id, is_enabled, site_key, secret_key,
      last_verified_at, last_verified_status, created_at, updated_at
  `;
  const params = [
    isEnabled === undefined ? null : isEnabled,
    siteKey   === undefined ? null : siteKey,
    secretKey === undefined ? null : secretKey,
    existing.id,
  ];
  const { rows } = await db.query(updateSql, params);
  return rows[0];
}

async function recordVerification(status) {
  const existing = await findSingleton();
  if (!existing) return null;
  const sql = `
    UPDATE public.recaptcha_settings
       SET last_verified_at     = NOW(),
           last_verified_status = $1,
           updated_at           = NOW()
     WHERE id = $2
    RETURNING last_verified_at, last_verified_status
  `;
  const { rows } = await db.query(sql, [status, existing.id]);
  return rows[0] || null;
}

module.exports = {
  findSingleton,
  upsertSingleton,
  recordVerification,
};
