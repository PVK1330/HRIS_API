'use strict';

const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');

/**
 * Request Password Reset
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.requestPasswordReset(email);
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
 * Login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  return ApiResponse.ok(res, result, 'Login successful.');
});

module.exports = {
  login,
  forgotPassword,
  verifyOtp,
  resetPassword
};
