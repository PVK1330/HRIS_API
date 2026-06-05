'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const currencyService = require('./currency.service');

const getCurrencySettings = asyncHandler(async (_req, res) => {
  const data = await currencyService.getCurrencySettings();
  return ApiResponse.ok(res, data, 'Currency settings retrieved');
});

// Read-only currency display/conversion/tax settings for any authenticated
// user (admins, employees) so the whole app can format & convert amounts.
const getPublicCurrencySettings = asyncHandler(async (_req, res) => {
  const data = await currencyService.getCurrencySettings();
  return ApiResponse.ok(res, data, 'Currency settings retrieved');
});

const updateCurrencySettings = asyncHandler(async (req, res) => {
  const data = await currencyService.updateCurrencySettings(req.body);
  return ApiResponse.ok(res, data, 'Currency settings updated');
});

// Pull the latest market exchange rates for the current base currency.
const refreshExchangeRates = asyncHandler(async (_req, res) => {
  const data = await currencyService.refreshRates();
  return ApiResponse.ok(res, data, 'Exchange rates refreshed');
});

module.exports = {
  getCurrencySettings,
  getPublicCurrencySettings,
  updateCurrencySettings,
  refreshExchangeRates,
};
