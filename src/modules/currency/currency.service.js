'use strict';

const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./currency.repository');
const exchangeRatesProvider = require('./exchangeRates.service');

// Auto-refresh cached rates when older than this (on read traffic / cron).
const RATES_STALE_MS = 12 * 60 * 60 * 1000;
let refreshInFlight = null;

const VALID_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR',
  'CAD', 'AUD', 'SGD', 'MYR', 'PKR', 'BDT', 'LKR', 'NPR', 'JPY', 'CNY',
  'CHF', 'SEK', 'NOK', 'DKK', 'ZAR', 'NGN', 'KES', 'GHS', 'EGP', 'MAD',
];

const VALID_POSITIONS = ['before', 'after', 'before-space', 'after-space'];

function normalizeRates(raw) {
  // Accepts an object { CODE: number } and returns a clean map of
  // CODE -> positive number (units of CODE per 1 unit of the default currency).
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [code, value] of Object.entries(raw)) {
    const c = String(code).trim().toUpperCase();
    const n = Number(value);
    if (VALID_CURRENCIES.includes(c) && Number.isFinite(n) && n > 0) {
      out[c] = n;
    }
  }
  return out;
}

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
    decimalPlaces: row.decimal_places === null || row.decimal_places === undefined
      ? 2
      : Number(row.decimal_places),
    taxEnabled: !!row.tax_enabled,
    taxLabel: row.tax_label ?? 'VAT',
    taxRate: row.tax_rate === null || row.tax_rate === undefined ? 0 : Number(row.tax_rate),
    exchangeRates: normalizeRates(row.exchange_rates),
    ratesUpdatedAt: row.rates_updated_at || null,
    ratesSource: row.rates_source || null,
  };
}

/**
 * Fetches the latest market rates for the current base currency and caches them.
 * @returns {Promise<object>} updated currency settings
 */
async function refreshRates() {
  const current = await repo.getCurrencySettings(null);
  if (!current) throw new ApiError(500, 'Currency settings not initialized');
  const base = String(current.default_currency || 'USD').toUpperCase();
  let live;
  try {
    live = await exchangeRatesProvider.fetchLiveRates(base, VALID_CURRENCIES);
  } catch (err) {
    throw new ApiError(502, `Could not fetch live exchange rates: ${err.message}`);
  }
  const updated = await repo.updateExchangeRates(null, {
    exchangeRates: live.rates,
    source: live.source,
  });
  return mapRow(updated);
}

/** Fire-and-forget refresh when cached rates are missing or stale. */
function autoRefreshIfStale(mapped) {
  const empty = !mapped.exchangeRates || Object.keys(mapped.exchangeRates).length === 0;
  const stale =
    !mapped.ratesUpdatedAt ||
    Date.now() - new Date(mapped.ratesUpdatedAt).getTime() > RATES_STALE_MS;
  if ((empty || stale) && !refreshInFlight) {
    refreshInFlight = refreshRates()
      .catch((e) => logger.warn(`[currency] auto rate refresh failed: ${e.message}`))
      .finally(() => { refreshInFlight = null; });
  }
}

async function getCurrencySettings() {
  const row = await repo.getCurrencySettings(null);
  if (!row) {
    throw new ApiError(500, 'Currency settings not initialized');
  }
  const mapped = mapRow(row);
  autoRefreshIfStale(mapped);
  return mapped;
}

/**
 * Converts an amount from one currency to another using the stored manual
 * exchange rates. Rates are expressed as "units of <code> per 1 unit of the
 * default currency"; the default currency itself is implicitly 1.
 *
 * @param {number} amount
 * @param {string} from   source currency code
 * @param {string} to     target currency code
 * @param {{ defaultCurrency: string, exchangeRates: Record<string, number> }} settings
 * @returns {number} converted amount (unrounded)
 */
function convertAmount(amount, from, to, settings) {
  const value = Number(amount) || 0;
  const base = String(settings.defaultCurrency || '').toUpperCase();
  const src = String(from || base).toUpperCase();
  const dst = String(to || base).toUpperCase();
  if (src === dst) return value;

  const rates = settings.exchangeRates || {};
  const rateOf = (code) => (code === base ? 1 : Number(rates[code]));

  const rFrom = rateOf(src);
  const rTo = rateOf(dst);
  // If we don't have a rate for either side, fail safe by returning the amount
  // unchanged (callers treat a missing rate as 1:1 rather than corrupting data).
  if (!Number.isFinite(rFrom) || rFrom <= 0 || !Number.isFinite(rTo) || rTo <= 0) {
    return value;
  }
  // amount(src) -> amount(base) -> amount(dst)
  return (value / rFrom) * rTo;
}

/** Tax portion for a subtotal given the settings (0 when tax disabled). */
function taxFor(amount, settings) {
  if (!settings?.taxEnabled) return 0;
  const rate = Number(settings.taxRate) || 0;
  return (Number(amount) || 0) * (rate / 100);
}

/**
 * @param {object} data
 */
async function updateCurrencySettings(data) {
  const input = data || {};
  const code = String(input.defaultCurrency || '').trim().toUpperCase();
  if (!VALID_CURRENCIES.includes(code)) {
    throw new ApiError(400, `Currency '${input.defaultCurrency}' is not supported`);
  }

  const pos = String(input.symbolPosition || '').trim();
  if (!VALID_POSITIONS.includes(pos)) {
    throw new ApiError(400, 'symbolPosition must be before, after, before-space or after-space');
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

  const decimalPlaces = Math.max(0, Math.min(4, Math.floor(Number(input.decimalPlaces ?? 2)) || 0));

  const taxEnabled = !!input.taxEnabled;
  const taxLabel = String(input.taxLabel || 'VAT').trim().slice(0, 20) || 'VAT';
  const taxRate = Number(input.taxRate);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new ApiError(400, 'taxRate must be between 0 and 100');
  }

  const before = await repo.getCurrencySettings(null);
  const baseChanged = !before || String(before.default_currency || '').toUpperCase() !== code;

  const updated = await repo.updateCurrencySettings(null, {
    defaultCurrency: code,
    currencySymbol: sym,
    symbolPosition: pos,
    decimalSeparator: dec,
    thousandSeparator: thou,
    decimalPlaces,
    taxEnabled,
    taxLabel,
    taxRate,
  });
  if (!updated) {
    throw new ApiError(500, 'Currency settings not initialized');
  }

  // Exchange rates are market-driven. If the base currency changed (old rates
  // are now meaningless) or none are cached yet, pull fresh ones — best-effort
  // so a provider hiccup never blocks saving the other settings.
  let mapped = mapRow(updated);
  const noRates = !mapped.exchangeRates || Object.keys(mapped.exchangeRates).length === 0;
  if (baseChanged || noRates) {
    try {
      mapped = await refreshRates();
    } catch (err) {
      logger.warn(`[currency] rate refresh after save failed: ${err.message}`);
    }
  }
  return mapped;
}

module.exports = {
  VALID_CURRENCIES,
  VALID_POSITIONS,
  getCurrencySettings,
  updateCurrencySettings,
  refreshRates,
  convertAmount,
  taxFor,
};
