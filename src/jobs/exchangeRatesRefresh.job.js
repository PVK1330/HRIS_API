'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const currencyService = require('../modules/currency/currency.service');

/** Pulls the latest market exchange rates for the platform base currency. */
async function runExchangeRatesRefresh() {
  const settings = await currencyService.refreshRates();
  const count = Object.keys(settings.exchangeRates || {}).length;
  logger.info(`[exchangeRates] refreshed ${count} rate(s) for base ${settings.defaultCurrency}`);
  return settings;
}

function startExchangeRatesRefreshCron() {
  if (process.env.DISABLE_FX_RATES_CRON === 'true') {
    logger.debug('Exchange rates refresh cron disabled');
    return null;
  }
  const opts = {};
  if (process.env.TZ) opts.timezone = process.env.TZ;

  // Daily at 06:30.
  const scheduled = cron.schedule('30 6 * * *', () => {
    runExchangeRatesRefresh().catch((e) => logger.error('[exchangeRates] refresh failed', e));
  }, opts);

  // Warm the cache shortly after boot (non-blocking) so rates are never empty.
  setTimeout(() => {
    runExchangeRatesRefresh().catch((e) => logger.warn(`[exchangeRates] startup refresh skipped: ${e.message}`));
  }, 10_000);

  logger.info('[exchangeRates] scheduled daily at 06:30');
  return scheduled;
}

module.exports = { startExchangeRatesRefreshCron, runExchangeRatesRefresh };
