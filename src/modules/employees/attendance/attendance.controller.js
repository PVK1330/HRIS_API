'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./attendance.service');

// GET /api/v1/employees/:employeeId/attendance?year=2026&month=5
const list = asyncHandler(async (req, res) => {
  const data = await service.getAttendance(req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Attendance retrieved successfully');
});

module.exports = { list };
