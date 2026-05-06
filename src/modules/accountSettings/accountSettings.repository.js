'use strict';

const db = require('../../config/db');

async function query(client, text, params) {
  if (client) return client.query(text, params);
  return db.query(text, params);
}

/**
 * @param {import('pg').PoolClient|null} client
 * @returns {Promise<object|null>}
 */
async function getAccountSettings(client) {
  const sql = `
    SELECT *
      FROM public.account_settings
     LIMIT 1
  `;
  const { rows } = await query(client, sql);
  return rows[0] || null;
}

/**
 * @param {import('pg').PoolClient|null} client
 * @param {{ publicRegistration: boolean, emailVerification: boolean, twoFactorAuth: boolean }} data
 */
async function updateAccountSettings(client, { publicRegistration, emailVerification, twoFactorAuth }) {
  const sql = `
    UPDATE public.account_settings
       SET public_registration = $1,
           email_verification = $2,
           two_factor_auth = $3,
           updated_at = NOW()
     WHERE id = (SELECT id FROM public.account_settings LIMIT 1)
 RETURNING *
  `;
  const { rows } = await query(client, sql, [
    publicRegistration,
    emailVerification,
    twoFactorAuth,
  ]);
  return rows[0] || null;
}

module.exports = {
  getAccountSettings,
  updateAccountSettings,
};
