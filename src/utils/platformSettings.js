'use strict';

const db = require('../config/db');
const currencyRepo = require('../modules/currency/currency.repository');

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_CURRENCY = 'AED';

let cache = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

async function loadPlatformContext() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const [settingsRes, currencyRow] = await Promise.all([
    db.query(
      `SELECT key, value FROM public.settings WHERE "group" = 'general' AND key IN ('timezone', 'date_format')`,
    ),
    currencyRepo.getCurrencySettings(null),
  ]);

  const byKey = Object.fromEntries(settingsRes.rows.map((r) => [r.key, r.value]));
  const timezone = (byKey.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const dateFormat = (byKey.date_format || 'DD/MM/YYYY').trim() || 'DD/MM/YYYY';
  const currency = (currencyRow?.default_currency || DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;

  cache = { timezone, dateFormat, currency };
  cacheAt = now;
  return cache;
}

async function getPlatformTimezone() {
  const ctx = await loadPlatformContext();
  return ctx.timezone;
}

async function getPlatformCurrency() {
  const ctx = await loadPlatformContext();
  return ctx.currency;
}

async function getPlatformContext() {
  return loadPlatformContext();
}

/** Stripe Checkout locale from platform timezone (UK → en-GB). */
function stripeLocaleForTimezone(timezone) {
  const map = {
    'Europe/London': 'en-GB',
    'Europe/Paris': 'fr',
    'Europe/Berlin': 'de',
    'Asia/Dubai': 'en',
    'Asia/Kolkata': 'en',
    'America/New_York': 'en',
  };
  return map[timezone] || 'auto';
}

module.exports = {
  getPlatformTimezone,
  getPlatformCurrency,
  getPlatformContext,
  stripeLocaleForTimezone,
  DEFAULT_TIMEZONE,
  DEFAULT_CURRENCY,
};
