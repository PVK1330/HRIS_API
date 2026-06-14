'use strict';

const env = require('../../config/env');

const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const tenantSettingsService = require('./tenantSettings.service');

function resolvePublicBaseUrl(req) {
  const fromEnv = process.env.APP_URL && String(process.env.APP_URL).trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  const port = env.PORT || 5000;
  return `http://localhost:${port}`;
}

const getAdminSettings = asyncHandler(async (req, res) => {
  const baseUrl = resolvePublicBaseUrl(req);
  const data = await tenantSettingsService.getAdminSettings(req.tenant.dbName, baseUrl);
  res.status(200).json({ success: true, data });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const baseUrl = resolvePublicBaseUrl(req);
  const data = await tenantSettingsService.updateAdminSettings(req.tenant.dbName, req.body, baseUrl);
  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data,
  });
});

const getLogo = asyncHandler(async (req, res) => {
  const baseUrl = resolvePublicBaseUrl(req);
  const data = await tenantSettingsService.getTenantLogo(req.tenant.dbName, baseUrl);
  res.status(200).json({ success: true, data });
});

const getTimezone = asyncHandler(async (req, res) => {
  const data = await tenantSettingsService.getAdminSettings(req.tenant.dbName, '');
  res.status(200).json({ success: true, data: { timezone: data?.timezone || 'UTC' } });
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const baseUrl = resolvePublicBaseUrl(req);
  const data = await tenantSettingsService.uploadLogo(req.tenant.dbName, req.file, baseUrl);
  res.status(200).json({
    success: true,
    message: 'Logo uploaded successfully',
    data,
  });
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getLogo,
  uploadLogo,
  getTimezone,
};
