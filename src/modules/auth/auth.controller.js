'use strict';

const authService = require('./auth.service');
const mfaService = require('./auth.mfa.service');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

/**
 * Request Password Reset
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email, tenantSlug, tenantId } = req.body;
  const result = await authService.requestPasswordReset(email, { tenantSlug, tenantId });
  return ApiResponse.ok(res, result, 'If the email exists, an OTP has been sent.');
});

/**
 * Verify OTP
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const result = await authService.verifyOTP(email, otp);
  return ApiResponse.ok(res, result, 'OTP verified successfully.');
});

/**
 * Reset Password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const result = await authService.resetPassword(email, otp, newPassword);
  return ApiResponse.ok(res, result, 'Password has been reset successfully.');
});

/**
 * Authenticated self-service password change.
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.user, { currentPassword, newPassword });
  return ApiResponse.ok(res, result, 'Password updated successfully.');
});

/**
 * Login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, tenantId, tenantSlug } = req.body;
  const result = await authService.login(email, password, { tenantId, tenantSlug });
  return ApiResponse.ok(res, result, 'Login successful.');
});

const getAccessProfile = asyncHandler(async (req, res) => {
  const result = await authService.getAccessProfile(req.user);
  return ApiResponse.ok(res, result, 'Access profile fetched successfully.');
});

/**
 * Verify a TOTP code to complete an MFA-gated login.
 */
const verifyTwoFactor = asyncHandler(async (req, res) => {
  const { mfaToken, code } = req.body;
  const result = await authService.verifyMfaLogin(mfaToken, code);
  return ApiResponse.ok(res, result, 'Login successful.');
});

/* --- Self-service MFA enrollment (authenticated) --- */

const getMfaStatus = asyncHandler(async (req, res) => {
  const result = await mfaService.getStatus(req.user);
  return ApiResponse.ok(res, result, 'MFA status fetched.');
});

const setupMfa = asyncHandler(async (req, res) => {
  const result = await mfaService.beginSetup(req.user);
  return ApiResponse.ok(res, result, 'Scan the QR code with your authenticator app.');
});

const enableMfa = asyncHandler(async (req, res) => {
  const result = await mfaService.enable(req.user, req.body.code);
  return ApiResponse.ok(res, result, 'Two-factor authentication enabled.');
});

const disableMfa = asyncHandler(async (req, res) => {
  const result = await mfaService.disable(req.user, req.body.code);
  return ApiResponse.ok(res, result, 'Two-factor authentication disabled.');
});

module.exports = {
  login,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  getAccessProfile,
  verifyTwoFactor,
  getMfaStatus,
  setupMfa,
  enableMfa,
  disableMfa,
};
