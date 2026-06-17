'use strict';

const service = require('./shifts.service');
const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');

// ─── Shifts ──────────────────────────────────────────────────────────────────

const listShifts = asyncHandler(async (req, res) => {
  const result = await service.listShifts(req.user.db_name, req.query);
  return ApiResponse.ok(res, result, 'Shifts retrieved successfully');
});

const getShift = asyncHandler(async (req, res) => {
  const result = await service.getShift(req.user.db_name, req.params.id);
  return ApiResponse.ok(res, result, 'Shift retrieved successfully');
});

const createShift = asyncHandler(async (req, res) => {
  const result = await service.createShift(req.user.db_name, req.body);
  return ApiResponse.created(res, result, 'Shift created successfully');
});

const updateShift = asyncHandler(async (req, res) => {
  const result = await service.updateShift(req.user.db_name, req.params.id, req.body);
  return ApiResponse.ok(res, result, 'Shift updated successfully');
});

const deleteShift = asyncHandler(async (req, res) => {
  const result = await service.deleteShift(req.user.db_name, req.params.id);
  return ApiResponse.ok(res, result, 'Shift deactivated successfully');
});

// ─── Assignments ─────────────────────────────────────────────────────────────

const listAssignments = asyncHandler(async (req, res) => {
  const result = await service.listAssignments(req.user.db_name, req.query);
  return ApiResponse.ok(res, result, 'Assignments retrieved successfully');
});

const assignShift = asyncHandler(async (req, res) => {
  const result = await service.assignShift(req.user.db_name, req.body);
  return ApiResponse.created(res, result, 'Shift assigned successfully');
});

const bulkAssignShift = asyncHandler(async (req, res) => {
  const result = await service.bulkAssignShift(req.user.db_name, req.body);
  return ApiResponse.created(
    res,
    result,
    `Shift assigned to ${result.assigned_count} employee(s)`,
  );
});

const removeAssignment = asyncHandler(async (req, res) => {
  const result = await service.removeAssignment(req.user.db_name, req.params.id);
  return ApiResponse.ok(res, result, 'Assignment removed successfully');
});

const getEmployeeCurrentShift = asyncHandler(async (req, res) => {
  const result = await service.getEmployeeCurrentShift(
    req.user.db_name,
    req.params.employeeId,
  );
  return ApiResponse.ok(res, result, 'Current shift retrieved successfully');
});

// ─── Change Requests ─────────────────────────────────────────────────────────

const listChangeRequests = asyncHandler(async (req, res) => {
  const result = await service.listChangeRequests(req.user.db_name, req.query, req.auth);
  return ApiResponse.ok(res, result, 'Change requests retrieved successfully');
});

const createChangeRequest = asyncHandler(async (req, res) => {
  const result = await service.createChangeRequest(req.user.db_name, req.body, req.user, req);
  return ApiResponse.created(res, result, 'Change request submitted successfully');
});

const approveChangeRequest = asyncHandler(async (req, res) => {
  const { action, reason, rejection_reason } = req.body;
  const result = await service.actOnChangeRequest(
    req.user.db_name,
    req.params.id,
    action,
    req.auth,
    req.user,
    reason || rejection_reason || null,
    req,
  );
  const verb = String(action).toLowerCase().startsWith('rej') ? 'rejected' : 'approved';
  return ApiResponse.ok(res, result, `Change request ${verb} successfully`);
});

module.exports = {
  listShifts,
  getShift,
  createShift,
  updateShift,
  deleteShift,
  listAssignments,
  assignShift,
  bulkAssignShift,
  removeAssignment,
  getEmployeeCurrentShift,
  listChangeRequests,
  createChangeRequest,
  approveChangeRequest,
};
