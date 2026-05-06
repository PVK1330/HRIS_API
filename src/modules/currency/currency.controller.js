'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const currencyService = require('./currency.service');

const getCurrencySettings = asyncHandler(async (_req, res) => {
  const data = await currencyService.getCurrencySettings();
  return ApiResponse.ok(res, data, 'Currency settings retrieved');
});

const updateCurrencySettings = asyncHandler(async (req, res) => {
  const data = await currencyService.updateCurrencySettings(req.body);
  return ApiResponse.ok(res, data, 'Currency settings updated');
});

module.exports = {
  getCurrencySettings,
  updateCurrencySettings,
};
