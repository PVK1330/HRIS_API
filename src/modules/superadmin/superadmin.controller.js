'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./superadmin.service');

/**
 * POST /api/v1/superadmin/login
 * Body: { email, password }
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await service.login({ email, password });

  if (result.mfaRequired) {
    return ApiResponse.ok(
      res,
      { mfaRequired: true, userId: result.userId, email: result.email },
      'Two-factor authentication required'
    );
  }

  const { token, superadmin } = result;

  return ApiResponse.ok(
    res,
    { superadmin },
    'Login successful',
    { token, superadmin }
  );
});

/**
 * POST /api/v1/superadmin/verify-2fa
 */
const verify2FA = asyncHandler(async (req, res) => {
  const { userId, code } = req.body;

  const { token, superadmin } = await service.verify2FA({ userId, code });

  return ApiResponse.ok(
    res,
    { superadmin },
    'Verification successful',
    { token, superadmin }
  );
});

module.exports = {
  login,
  verify2FA,
};
