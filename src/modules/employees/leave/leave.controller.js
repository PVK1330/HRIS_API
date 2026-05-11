'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./leave.service');

// GET /api/v1/employees/:employeeId/leave?year=2026&status=Approved
const list = asyncHandler(async (req, res) => {
  const data = await service.getLeave(req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Leave data retrieved successfully');
});

module.exports = { list };
