'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse = require('../../../utils/ApiResponse');
const service = require('./attendance.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.getAttendance(req.auth, req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Attendance retrieved successfully');
});

const listAll = asyncHandler(async (req, res) => {
  const data = await service.listAttendance(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Attendance retrieved successfully');
});

const mark = asyncHandler(async (req, res) => {
  const data = await service.markAttendance(req.auth, req.user, req.body, req);
  return ApiResponse.created(res, { record: data }, 'Attendance marked successfully');
});

const checkIn = asyncHandler(async (req, res) => {
  const data = await service.checkIn(req.auth, req.user, req.body, req);
  return ApiResponse.ok(res, { record: data }, 'Check-in successful');
});

const checkOut = asyncHandler(async (req, res) => {
  const data = await service.checkOut(req.auth, req.user, req.body, req);
  return ApiResponse.ok(res, { record: data }, 'Check-out successful');
});

const submitRegularization = asyncHandler(async (req, res) => {
  const data = await service.submitRegularization(req.auth, req.user, req.body, req);
  return ApiResponse.created(res, { record: data }, 'Regularization submitted');
});

const pendingRegularizations = asyncHandler(async (req, res) => {
  const data = await service.getPendingRegularizations(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Pending regularizations retrieved');
});

const regularize = asyncHandler(async (req, res) => {
  const data = await service.regularize(req.auth, req.user, req.params.id, req.body, req);
  return ApiResponse.ok(res, { record: data }, 'Regularization processed');
});

const pendingOvertime = asyncHandler(async (req, res) => {
  const data = await service.getPendingOvertime(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Pending overtime retrieved');
});

const processOvertime = asyncHandler(async (req, res) => {
  const data = await service.processOvertime(req.auth, req.user, req.params.id, req.body, req);
  return ApiResponse.ok(res, { record: data }, 'Overtime processed');
});

const createOvertime = asyncHandler(async (req, res) => {
  const data = await service.createOvertime(req.auth, req.user, req.body, req);
  return ApiResponse.created(res, { record: data }, 'Overtime recorded');
});

const overtimeRecords = asyncHandler(async (req, res) => {
  const data = await service.getOvertimeRecords(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Overtime records retrieved');
});

const payrollSummary = asyncHandler(async (req, res) => {
  const data = await service.getPayrollSummary(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Payroll attendance summary retrieved');
});

const detail = asyncHandler(async (req, res) => {
  const data = await service.getRecordDetail(req.auth, req.user, req.params.id);
  return ApiResponse.ok(res, data, 'Attendance record retrieved');
});

const myToday = asyncHandler(async (req, res) => {
  const data = await service.getMyToday(req.auth, req.user);
  return ApiResponse.ok(res, data, 'Today attendance status retrieved');
});

const dashboard = asyncHandler(async (req, res) => {
  const data = await service.getDashboard(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Attendance dashboard retrieved');
});

const report = asyncHandler(async (req, res) => {
  const data = await service.getReport(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Attendance report generated');
});

const regularizationHistory = asyncHandler(async (req, res) => {
  const data = await service.getRegularizationHistory(req.auth, req.user, req.query);
  return ApiResponse.ok(res, data, 'Regularization history retrieved');
});

const exportPdf = asyncHandler(async (req, res) => {
  const { buffer, contentType, filename } = await service.exportReport(
    req.auth,
    req.user,
    req.query,
    'pdf',
    req,
  );
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

const exportExcel = asyncHandler(async (req, res) => {
  const { buffer, contentType, filename } = await service.exportReport(
    req.auth,
    req.user,
    req.query,
    'excel',
    req,
  );
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

module.exports = {
  list,
  listAll,
  mark,
  checkIn,
  checkOut,
  submitRegularization,
  pendingRegularizations,
  regularize,
  pendingOvertime,
  overtimeRecords,
  processOvertime,
  createOvertime,
  payrollSummary,
  detail,
  myToday,
  dashboard,
  report,
  regularizationHistory,
  exportPdf,
  exportExcel,
};
