'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./performance.service');

// GET /api/v1/employees/:employeeId/performance
const list = asyncHandler(async (req, res) => {
  const data = await service.getPerformance(req.user, req.params.employeeId);
  return ApiResponse.ok(res, data, 'Performance data retrieved successfully');
});

module.exports = { list };
