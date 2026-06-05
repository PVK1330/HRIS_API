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
  {
    defaultCurrency,
    currencySymbol,
    symbolPosition,
    decimalSeparator,
    thousandSeparator,
    decimalPlaces,
    taxEnabled,
    taxLabel,
    taxRate,
  }
) {
  // Note: exchange_rates are NOT written here — they are managed automatically
  // from the live market provider (see updateExchangeRates).
  const sql = `
    UPDATE public.currency_settings
       SET default_currency = $1,
           currency_symbol = $2,
           symbol_position = $3,
           decimal_separator = $4,
           thousand_separator = $5,
           decimal_places = $6,
           tax_enabled = $7,
           tax_label = $8,
           tax_rate = $9,
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
    decimalPlaces,
    taxEnabled,
    taxLabel,
    taxRate,
  ]);
  return rows[0] || null;
}

/** Persists the live-fetched exchange rates + provenance. */
async function updateExchangeRates(client, { exchangeRates, source }) {
  const sql = `
    UPDATE public.currency_settings
       SET exchange_rates = $1::jsonb,
           rates_updated_at = NOW(),
           rates_source = $2,
           updated_at = NOW()
     WHERE id = (SELECT id FROM public.currency_settings LIMIT 1)
 RETURNING *
  `;
  const { rows } = await query(client, sql, [JSON.stringify(exchangeRates || {}), source || null]);
  return rows[0] || null;
}

module.exports = {
  getCurrencySettings,
  updateCurrencySettings,
  updateExchangeRates,
};
