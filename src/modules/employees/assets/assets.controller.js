'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./assets.service');

// GET /api/v1/employees/:employeeId/assets
const list = asyncHandler(async (req, res) => {
  const data = await service.getAssets(req.user, req.params.employeeId);
  return ApiResponse.ok(res, data, 'Assets retrieved successfully');
});

module.exports = { list };
