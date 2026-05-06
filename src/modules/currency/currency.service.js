'use strict';

const ApiError = require('../../utils/ApiError');
const repo = require('./currency.repository');

const VALID_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR',
  'CAD', 'AUD', 'SGD', 'MYR', 'PKR', 'BDT', 'LKR', 'NPR', 'JPY', 'CNY',
  'CHF', 'SEK', 'NOK', 'DKK', 'ZAR', 'NGN', 'KES', 'GHS', 'EGP', 'MAD',
];

function mapRow(row) {
  if (!row) return null;
  return {
    defaultCurrency: row.default_currency ?? 'USD',
    currencySymbol: row.currency_symbol ?? '$',
    symbolPosition: row.symbol_position ?? 'before',
    decimalSeparator: row.decimal_separator ?? '.',
    thousandSeparator: row.thousand_separator === null || row.thousand_separator === undefined
      ? ''
      : String(row.thousand_separator),
  };
}

async function getCurrencySettings() {
  const row = await repo.getCurrencySettings(null);
  if (!row) {
    throw new ApiError(500, 'Currency settings not initialized');
  }
  return mapRow(row);
}

/**
 * @param {{
 *   defaultCurrency: string,
 *   currencySymbol: string,
 *   symbolPosition: string,
 *   decimalSeparator: string,
 *   thousandSeparator: string,
 * }} data
 */
async function updateCurrencySettings(data) {
  const input = data || {};
  const code = String(input.defaultCurrency || '').trim().toUpperCase();
  if (!VALID_CURRENCIES.includes(code)) {
    throw new ApiError(400, `Currency '${input.defaultCurrency}' is not supported`);
  }

  const pos = String(input.symbolPosition || '').trim();
  if (pos !== 'before' && pos !== 'after') {
    throw new ApiError(400, 'Symbol position must be before or after');
  }

  const dec = String(input.decimalSeparator);
  const thou = input.thousandSeparator === null || input.thousandSeparator === undefined
    ? ''
    : String(input.thousandSeparator);

  if (dec === thou) {
    throw new ApiError(400, 'Decimal and thousand separators must be different');
  }

  const sym = String(input.currencySymbol || '').trim();
  if (!sym || sym.length > 5) {
    throw new ApiError(400, 'currencySymbol is required (max 5 chars)');
  }

  const updated = await repo.updateCurrencySettings(null, {
    defaultCurrency: code,
    currencySymbol: sym,
    symbolPosition: pos,
    decimalSeparator: dec,
    thousandSeparator: thou,
  });
  if (!updated) {
    throw new ApiError(500, 'Currency settings not initialized');
  }
  return mapRow(updated);
}

module.exports = {
  VALID_CURRENCIES,
  getCurrencySettings,
  updateCurrencySettings,
};
