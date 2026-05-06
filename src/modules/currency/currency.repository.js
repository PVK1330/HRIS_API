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
async function getCurrencySettings(client) {
  const sql = `
    SELECT *
      FROM public.currency_settings
     LIMIT 1
  `;
  const { rows } = await query(client, sql);
  return rows[0] || null;
}

/**
 * @param {import('pg').PoolClient|null} client
 * @param {{
 *   defaultCurrency: string,
 *   currencySymbol: string,
 *   symbolPosition: string,
 *   decimalSeparator: string,
 *   thousandSeparator: string,
 * }} data
 */
async function updateCurrencySettings(
  client,
  { defaultCurrency, currencySymbol, symbolPosition, decimalSeparator, thousandSeparator }
) {
  const sql = `
    UPDATE public.currency_settings
       SET default_currency = $1,
           currency_symbol = $2,
           symbol_position = $3,
           decimal_separator = $4,
           thousand_separator = $5,
           updated_at = NOW()
     WHERE id = (SELECT id FROM public.currency_settings LIMIT 1)
 RETURNING *
  `;
  const { rows } = await query(client, sql, [
    defaultCurrency,
    currencySymbol,
    symbolPosition,
    decimalSeparator,
    thousandSeparator,
  ]);
  return rows[0] || null;
}

module.exports = {
  getCurrencySettings,
  updateCurrencySettings,
};
