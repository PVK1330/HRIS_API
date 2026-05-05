'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const accountSettingsService = require('./accountSettings.service');

const getAccountSettings = asyncHandler(async (_req, res) => {
  const data = await accountSettingsService.getAccountSettings();
  return ApiResponse.ok(res, data, 'Account settings retrieved');
});

const updateAccountSettings = asyncHandler(async (req, res) => {
  const data = await accountSettingsService.updateAccountSettings(req.body);
  return ApiResponse.ok(res, data, 'Account settings updated');
});

module.exports = {
  getAccountSettings,
  updateAccountSettings,
};
