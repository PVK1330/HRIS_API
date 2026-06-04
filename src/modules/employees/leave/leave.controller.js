'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./leave.service');

// GET /api/v1/employees/:employeeId/leave
const list = asyncHandler(async (req, res) => {
  const data = await service.getLeave(req.user, req.params.employeeId, req.query);
  return ApiResponse.ok(res, data, 'Leave data retrieved successfully');
});

// GET /api/v1/leave
const listAll = asyncHandler(async (req, res) => {
  const data = await service.listLeave(req.user, req.query);
  return ApiResponse.ok(res, data, 'Leave requests retrieved successfully');
});

// POST /api/v1/leave
const apply = asyncHandler(async (req, res) => {
  const data = await service.applyLeave(req.user, req.body);
  return ApiResponse.created(res, { request: data }, 'Leave request submitted');
});

// PATCH /api/v1/leave/:id
const process = asyncHandler(async (req, res) => {
  const data = await service.processLeave(req.user, req.params.id, req.body);
  return ApiResponse.ok(res, { request: data }, 'Leave request updated');
});

// GET /api/v1/leave/balances
const balances = asyncHandler(async (req, res) => {
  const data = await service.listBalances(req.user, req.query);
  return ApiResponse.ok(res, data, 'Leave balances retrieved');
});

// POST /api/v1/leave/carry-forward
const carryForward = asyncHandler(async (req, res) => {
  const data = await service.runCarryForward(req.user, req.body);
  return ApiResponse.ok(res, data, 'Leave carry-forward processed');
});

module.exports = { list, listAll, apply, process, balances, carryForward };
