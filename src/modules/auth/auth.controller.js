'use strict';

const authService = require('./auth.service');
const mfaService = require('./auth.mfa.service');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const env = require('../../config/env');

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

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
 * Login — issues short-lived access token (JSON) + long-lived refresh token (httpOnly cookie).
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, tenantId, tenantSlug } = req.body;
  const result = await authService.login(email, password, { tenantId, tenantSlug });

  // MFA required — no tokens yet, just the challenge
  if (result.mfaRequired) {
    return ApiResponse.ok(res, result, 'Login successful.');
  }

  const { refreshToken, ...publicResult } = result;
  if (refreshToken) setRefreshCookie(res, refreshToken);

  return ApiResponse.ok(res, publicResult, 'Login successful.');
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

  if (!result.mfaRequired) {
    const { refreshToken, ...publicResult } = result;
    if (refreshToken) setRefreshCookie(res, refreshToken);
    return ApiResponse.ok(res, publicResult, 'Login successful.');
  }

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

const exchangeImpersonationCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const result = await authService.redeemImpersonationCode(code);

  const { refreshToken, ...publicResult } = result;
  if (refreshToken) setRefreshCookie(res, refreshToken);

  return ApiResponse.ok(res, publicResult, 'Impersonation session established.');
});

/**
 * Refresh access token using the httpOnly refresh-token cookie.
 * Rotates the refresh token on every call (old jti revoked, new one issued).
 */
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  const { accessToken, refreshToken } = await authService.verifyAndRotateRefreshToken(token);
  setRefreshCookie(res, refreshToken);
  return ApiResponse.ok(res, { token: accessToken }, 'Token refreshed.');
});

/**
 * Logout — revokes the refresh token in the DB and clears the cookie.
 * The access token expires naturally (≤15 min).
 */
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  await authService.revokeRefreshToken(token);
  clearRefreshCookie(res);
  return ApiResponse.ok(res, null, 'Logged out successfully.');
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
  exchangeImpersonationCode,
  refresh,
  logout,
};
