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

  const { token, superadmin } = await service.login({ email, password });

  return ApiResponse.ok(
    res,
    { superadmin },
    'Login successful',
    { token, superadmin }
  );
});

module.exports = {
  login,
};
