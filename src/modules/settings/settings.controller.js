'use strict';

const path = require('path');
const fs = require('fs');

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const service = require('./settings.service');

/* -------------------- helpers -------------------- */

/**
 * Builds the public base URL used for logo links — e.g. http://localhost:5000
 * Honors APP_URL when set, otherwise falls back to the request's own host.
 */
function getBaseUrl(req) {
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/* -------------------- General -------------------- */

const getGeneralSettings = asyncHandler(async (_req, res) => {
  const data = await service.getSettingsByGroup('general');
  return ApiResponse.ok(res, data, 'General settings retrieved');
});

const updateGeneralSettings = asyncHandler(async (req, res) => {
  const data = await service.updateSettingsByGroup('general', req.body);
  return ApiResponse.ok(res, data, 'General settings updated');
});

/* -------------------- Company -------------------- */

const getCompanySettings = asyncHandler(async (_req, res) => {
  const data = await service.getSettingsByGroup('company');
  return ApiResponse.ok(res, data, 'Company settings retrieved');
});

const updateCompanySettings = asyncHandler(async (req, res) => {
  const data = await service.updateSettingsByGroup('company', req.body);
  return ApiResponse.ok(res, data, 'Company settings updated');
});

/* -------------------- Email -------------------- */

const getEmailSettings = asyncHandler(async (_req, res) => {
  const data = await service.getEmailSettingsMasked();
  return ApiResponse.ok(res, data, 'Email settings retrieved');
});

const updateEmailSettings = asyncHandler(async (req, res) => {
  const data = await service.updateEmailSettings(req.body);
  return ApiResponse.ok(res, data, 'Email settings updated');
});

const sendTestEmail = asyncHandler(async (req, res) => {
  const sendTo = req.body && (req.body.sendTo || req.body.to);
  if (!sendTo) throw new ApiError(400, 'sendTo is required');

  const result = await service.sendTestEmail({ to: sendTo });
  return ApiResponse.ok(res, result, 'Test email sent successfully');
});

/* -------------------- Email Templates -------------------- */

const listEmailTemplates = asyncHandler(async (_req, res) => {
  const data = await service.listEmailTemplates();
  return ApiResponse.ok(res, data, 'Email templates retrieved');
});

const getEmailTemplate = asyncHandler(async (req, res) => {
  const data = await service.getEmailTemplate(req.params.slug);
  return ApiResponse.ok(res, data, 'Email template retrieved');
});

const updateEmailTemplate = asyncHandler(async (req, res) => {
  const data = await service.updateEmailTemplate(req.params.slug, req.body);
  return ApiResponse.ok(res, data, 'Email template updated');
});

const listEmailLogs = asyncHandler(async (_req, res) => {
  const data = await service.getEmailLogs();
  return ApiResponse.ok(res, data, 'Email logs retrieved');
});

/* -------------------- Logo upload -------------------- */

function logoUploadHandler(type) {
  return asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "logo")');
    const saved = await service.saveLogo(type, req.file);

    const baseUrl = getBaseUrl(req);
    return ApiResponse.ok(
      res,
      {
        type: saved.type,
        path: saved.path,
        url: `${baseUrl}${saved.path}`,
      },
      `${type} logo uploaded successfully`
    );
  });
}

const uploadLargeLogo  = logoUploadHandler('large');
const uploadSmallLogo  = logoUploadHandler('small');
const uploadFavicon    = logoUploadHandler('favicon');

const getLogos = asyncHandler(async (req, res) => {
  const data = await service.getLogos(getBaseUrl(req));
  return ApiResponse.ok(res, data, 'Logos retrieved');
});

/* -------------------- System Info -------------------- */

const getSystemInfo = asyncHandler(async (_req, res) => {
  let appVersion = 'unknown';
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      appVersion = pkg.version || 'unknown';
    }
  } catch (_) {
    // best-effort; never fail the system-info endpoint over a missing package.json
  }

  const data = {
    nodeVersion:  process.version,
    platform:     process.platform,
    memoryUsage:  process.memoryUsage(),
    uptime:       process.uptime(),
    mainDatabase: env.DB.database,
    environment:  env.NODE_ENV,
    appVersion,
  };

  return ApiResponse.ok(res, data, 'System info retrieved');
});

const getSettingsMeta = asyncHandler(async (_req, res) => {
  const data = service.getSettingsMeta();
  return ApiResponse.ok(res, data, 'Settings metadata retrieved');
});

module.exports = {
  // general
  getGeneralSettings,
  updateGeneralSettings,
  // company
  getCompanySettings,
  updateCompanySettings,
  // email
  getEmailSettings,
  updateEmailSettings,
  sendTestEmail,
  // email templates
  listEmailTemplates,
  getEmailTemplate,
  updateEmailTemplate,
  listEmailLogs,
  // logos
  uploadLargeLogo,
  uploadSmallLogo,
  uploadFavicon,
  getLogos,
  // system info
  getSystemInfo,
  // metadata
  getSettingsMeta,
};
