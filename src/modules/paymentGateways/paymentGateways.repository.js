'use strict';

const db = require('../../config/db');

/**
 * Repository: pure data-access for public.payment_gateways.
 * No business logic / no masking / no formatting — just parameterized SQL.
 */

const BASE_SELECT = `
  SELECT
    id,
    slug,
    name,
    is_enabled,
    credentials,
    test_mode,
    last_verified_at,
    last_verified_status,
    created_at,
    updated_at
  FROM public.payment_gateways
`;

async function findAll() {
  const sql = `${BASE_SELECT} ORDER BY name ASC`;
  const { rows } = await db.query(sql);
  return rows;
}

async function findBySlug(slug) {
  const sql = `${BASE_SELECT} WHERE slug = $1 LIMIT 1`;
  const { rows } = await db.query(sql, [slug]);
  return rows[0] || null;
}

/**
 * Update settable fields (everything except slug, name, id, timestamps).
 * Any of `isEnabled`, `testMode`, `credentials` may be omitted (`undefined`).
 */
async function updateBySlug(slug, { isEnabled, testMode, credentials }) {
  const sql = `
    UPDATE public.payment_gateways
       SET is_enabled  = COALESCE($1, is_enabled),
           test_mode   = COALESCE($2, test_mode),
           credentials = COALESCE($3::jsonb, credentials),
           updated_at  = NOW()
     WHERE slug = $4
    RETURNING
      id, slug, name, is_enabled, credentials, test_mode,
      last_verified_at, last_verified_status, created_at, updated_at
  `;
  const params = [
    isEnabled === undefined ? null : isEnabled,
    testMode  === undefined ? null : testMode,
    credentials === undefined ? null : JSON.stringify(credentials),
    slug,
  ];
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

/**
 * Persist the outcome of a connectivity test against the live gateway.
 * @param {string} slug
 * @param {'success'|'failed'|'untested'} status
 */
async function recordVerification(slug, status) {
  const sql = `
    UPDATE public.payment_gateways
       SET last_verified_at     = NOW(),
           last_verified_status = $1,
           updated_at           = NOW()
     WHERE slug = $2
    RETURNING last_verified_at, last_verified_status
  `;
  const { rows } = await db.query(sql, [status, slug]);
  return rows[0] || null;
}

module.exports = {
  findAll,
  findBySlug,
  updateBySlug,
  recordVerification,
};
