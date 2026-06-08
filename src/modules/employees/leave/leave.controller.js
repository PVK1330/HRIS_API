'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./leave.service');

// GET /api/v1/employees/:employeeId/leave
const list = asyncHandler(async (req, res) => {
  const data = await service.getLeave(req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Leave data retrieved successfully');
});

// GET /api/v1/leave/types
const getTypes = asyncHandler(async (req, res) => {
  const data = await service.getActiveLeaveTypes(req.user);
  return ApiResponse.ok(res, data, 'Active leave types retrieved');
});

// GET /api/v1/leave
const listAll = asyncHandler(async (req, res) => {
  const data = await service.listLeave(req.user, req.auth, req.query);
  return ApiResponse.ok(res, data, 'Leave requests retrieved successfully');
});

// POST /api/v1/leave
const apply = asyncHandler(async (req, res) => {
  const data = await service.applyLeave(req.user, req.auth, req.body);
  return ApiResponse.created(res, { request: data }, 'Leave request submitted');
});

// PATCH /api/v1/leave/:id
const process = asyncHandler(async (req, res) => {
  const data = await service.processLeave(req.user, req.auth, req.params.id, req.body);
  return ApiResponse.ok(res, { request: data }, 'Leave request updated');
});

// GET /api/v1/leave/balances
const balances = asyncHandler(async (req, res) => {
  const data = await service.listBalances(req.user, req.auth, req.query);
  return ApiResponse.ok(res, data, 'Leave balances retrieved');
});

// POST /api/v1/leave/carry-forward
const carryForward = asyncHandler(async (req, res) => {
  const data = await service.runCarryForward(req.user, req.body);
  return ApiResponse.ok(res, data, 'Leave carry-forward processed');
});

// GET /api/v1/leave/export/pdf
const exportPdf = asyncHandler(async (req, res) => {
  const { buffer, contentType, filename } = await service.exportLeave(req.user, req.auth, req.query, 'pdf', req);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

// GET /api/v1/leave/export/excel
const exportExcel = asyncHandler(async (req, res) => {
  const { buffer, contentType, filename } = await service.exportLeave(req.user, req.auth, req.query, 'excel', req);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

module.exports = { list, getTypes, listAll, apply, process, balances, carryForward, exportPdf, exportExcel };
