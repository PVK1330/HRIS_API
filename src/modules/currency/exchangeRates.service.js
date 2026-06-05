'use strict';

const axios = require('axios');

// Free, keyless FX provider. Returns rates as "units of <code> per 1 unit of
// the base currency" — which is exactly the convention the app stores/uses.
// Supports 160+ currencies incl. AED/INR/Gulf currencies.
const SOURCE = 'open.er-api.com';
const providerUrl = (base) => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;

/**
 * Fetches live market rates for a base currency.
 * @param {string} baseCurrency
 * @param {string[]} [allowed] optional whitelist of currency codes to keep
 * @returns {Promise<{ base: string, rates: Record<string, number>, source: string }>}
 * @throws on network/provider failure
 */
async function fetchLiveRates(baseCurrency, allowed) {
  const base = String(baseCurrency || 'USD').toUpperCase();
  const { data } = await axios.get(providerUrl(base), {
    timeout: 8000,
    headers: { Accept: 'application/json' },
  });

  if (!data || data.result !== 'success' || !data.rates || typeof data.rates !== 'object') {
    throw new Error(data?.['error-type'] || 'Exchange rate provider returned no rates');
  }

  const rates = {};
  for (const [code, rate] of Object.entries(data.rates)) {
    const c = String(code).toUpperCase();
    const n = Number(rate);
    if (c !== base && Number.isFinite(n) && n > 0 && (!allowed || allowed.includes(c))) {
      rates[c] = n;
    }
  }
  return { base, rates, source: SOURCE };
}

module.exports = { fetchLiveRates, SOURCE };
