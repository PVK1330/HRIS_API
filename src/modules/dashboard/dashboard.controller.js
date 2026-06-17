'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse  = require('../../utils/ApiResponse');
const service      = require('./dashboard.service');

/**
 * GET /api/v1/dashboard/attendance
 * Query: ?date=YYYY-MM-DD
 */
const getAttendanceDashboard = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const filters = { date: req.query.date };
  const data = await service.getAttendanceDashboard(db_name, filters);
  return ApiResponse.ok(res, data, 'Attendance dashboard fetched successfully');
});

/**
 * GET /api/v1/dashboard/manager
 * managerId resolved from JWT (req.user.employeeId)
 */
const getManagerDashboard = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const managerId = req.user.employeeId || req.auth?.employeeId;
  const data = await service.getManagerDashboard(db_name, managerId);
  return ApiResponse.ok(res, data, 'Manager dashboard fetched successfully');
});

/**
 * GET /api/v1/dashboard/payroll
 */
const getPayrollDashboard = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await service.getPayrollDashboard(db_name);
  return ApiResponse.ok(res, data, 'Payroll dashboard fetched successfully');
});

/**
 * GET /api/v1/dashboard/leave
 * Query: ?year=YYYY&month=M
 */
const getLeaveDashboard = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const filters = {
    year:  req.query.year  ? parseInt(req.query.year, 10)  : undefined,
    month: req.query.month ? parseInt(req.query.month, 10) : undefined,
  };
  const data = await service.getLeaveDashboard(db_name, filters);
  return ApiResponse.ok(res, data, 'Leave dashboard fetched successfully');
});

module.exports = {
  getAttendanceDashboard,
  getManagerDashboard,
  getPayrollDashboard,
  getLeaveDashboard,
};
