'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const tenantSettingsService = require('./tenantSettings.service');

const getAdminSettings = asyncHandler(async (req, res) => {
  const data = await tenantSettingsService.getAdminSettings(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const data = await tenantSettingsService.updateAdminSettings(req.tenant.dbName, req.body);
  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data,
  });
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const data = await tenantSettingsService.uploadLogo(req.tenant.dbName, req.file);
  res.status(200).json({
    success: true,
    message: 'Logo uploaded successfully',
    data,
  });
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  uploadLogo,
};
