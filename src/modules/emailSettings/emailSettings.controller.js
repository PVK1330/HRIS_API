'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse  = require('../../utils/ApiResponse');
const service      = require('./emailSettings.service');

/**
 * GET /api/v1/admin/settings/email
 * Returns current SMTP settings (password never returned).
 */
const getEmailSettings = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await service.getEmailSettings(db_name);
  return ApiResponse.ok(res, data, 'Email settings fetched successfully');
});

/**
 * PUT /api/v1/admin/settings/email
 * Update SMTP settings.
 * Body keys (all optional):
 *   smtp_host, smtp_port, smtp_username, smtp_password (write-only),
 *   sender_email, sender_name, email_notifications_enabled, smtp_secure
 */
const updateEmailSettings = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await service.updateEmailSettings(db_name, req.body || {});
  return ApiResponse.ok(res, data, 'Email settings updated successfully');
});

/**
 * POST /api/v1/admin/settings/email/test
 * Verifies the current SMTP configuration by opening a connection.
 */
const testEmailSettings = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const result = await service.testEmailSettings(db_name);
  const statusCode = result.success ? 200 : 422;
  return res.status(statusCode).json({
    success: result.success,
    message: result.message,
    data:    null,
  });
});

module.exports = {
  getEmailSettings,
  updateEmailSettings,
  testEmailSettings,
};
