'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./attendance.service');

// GET /api/v1/employees/:employeeId/attendance
const list = asyncHandler(async (req, res) => {
  const data = await service.getAttendance(req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Attendance retrieved successfully');
});

// GET /api/v1/attendance
const listAll = asyncHandler(async (req, res) => {
  const data = await service.listAttendance(req.user, req.query);
  return ApiResponse.ok(res, data, 'Attendance retrieved successfully');
});

// POST /api/v1/attendance
const mark = asyncHandler(async (req, res) => {
  const data = await service.markAttendance(req.user, req.body);
  return ApiResponse.created(res, { record: data }, 'Attendance marked successfully');
});

// GET /api/v1/attendance/regularizations
const pendingRegularizations = asyncHandler(async (req, res) => {
  const data = await service.getPendingRegularizations(req.user, req.query);
  return ApiResponse.ok(res, data, 'Pending regularizations retrieved');
});

// PATCH /api/v1/attendance/:id/regularize
const regularize = asyncHandler(async (req, res) => {
  const data = await service.regularize(req.user, req.params.id, req.body);
  return ApiResponse.ok(res, { record: data }, 'Regularization processed');
});

module.exports = { list, listAll, mark, pendingRegularizations, regularize };
