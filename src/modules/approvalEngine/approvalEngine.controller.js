'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./approvalEngine.service');

// ─── Workflows ───────────────────────────────────────────────────────────────

const listWorkflows = asyncHandler(async (req, res) => {
  const result = await service.listWorkflows(req.user.db_name, req.query);
  return ApiResponse.ok(res, result, 'Workflows retrieved successfully');
});

const getWorkflow = asyncHandler(async (req, res) => {
  const result = await service.getWorkflow(req.user.db_name, req.params.id);
  return ApiResponse.ok(res, result, 'Workflow retrieved successfully');
});

const createWorkflow = asyncHandler(async (req, res) => {
  const result = await service.createWorkflow(req.user.db_name, req.body);
  return ApiResponse.created(res, result, 'Workflow created successfully');
});

const updateWorkflow = asyncHandler(async (req, res) => {
  const result = await service.updateWorkflow(
    req.user.db_name,
    req.params.id,
    req.body,
  );
  return ApiResponse.ok(res, result, 'Workflow updated successfully');
});

// ─── Pending Approvals ───────────────────────────────────────────────────────

const getPendingApprovals = asyncHandler(async (req, res) => {
  // Aggregates the real column-based queues; per-row can_act handles authorization,
  // so tenant admins without a linked employee profile still see everything.
  const result = await service.getPendingApprovals(req.auth, req.user);
  return ApiResponse.ok(res, result, 'Pending approvals retrieved successfully');
});

// ─── My Requests ─────────────────────────────────────────────────────────────

const getMyRequests = asyncHandler(async (req, res) => {
  const result = await service.getMyRequests(req.auth, req.user);
  return ApiResponse.ok(res, result, 'Requests retrieved successfully');
});

// ─── Requests ────────────────────────────────────────────────────────────────

const createRequest = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  // Default to the authenticated employee if not explicitly provided
  if (!body.employee_id && req.user.employeeId) {
    body.employee_id = req.user.employeeId;
  }
  if (!body.employee_id) {
    throw ApiError.badRequest('employee_id is required');
  }
  const result = await service.createRequest(req.user.db_name, body);
  return ApiResponse.created(res, result, 'Approval request created successfully');
});

const actOnRequest = asyncHandler(async (req, res) => {
  const { action, remarks, source } = req.body;
  if (!action) {
    throw ApiError.badRequest('action is required');
  }
  if (!source) {
    throw ApiError.badRequest('source is required (regularization | overtime | shift)');
  }
  const result = await service.actOnRequest(
    req.auth,
    req.user,
    { source, id: req.params.id, action, remarks },
    req,
  );
  return ApiResponse.ok(res, result, 'Action recorded successfully');
});

// ─── Delegations ─────────────────────────────────────────────────────────────

const listDelegations = asyncHandler(async (req, res) => {
  const { employeeId } = req.user;
  if (!employeeId) {
    throw ApiError.badRequest('No employee profile linked to this account');
  }
  const result = await service.listDelegations(req.user.db_name, employeeId);
  return ApiResponse.ok(res, result, 'Delegations retrieved successfully');
});

const createDelegation = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  // Force delegator to be the authenticated employee (prevent spoofing)
  if (req.user.employeeId) {
    body.delegator_employee_id = req.user.employeeId;
  }
  if (!body.delegator_employee_id) {
    throw ApiError.badRequest('No employee profile linked to this account');
  }
  const result = await service.createDelegation(req.user.db_name, body);
  return ApiResponse.created(res, result, 'Delegation created successfully');
});

const revokeDelegation = asyncHandler(async (req, res) => {
  const { employeeId } = req.user;
  if (!employeeId) {
    throw ApiError.badRequest('No employee profile linked to this account');
  }
  const result = await service.revokeDelegation(
    req.user.db_name,
    req.params.id,
    employeeId,
  );
  return ApiResponse.ok(res, result, 'Delegation revoked successfully');
});

module.exports = {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  getPendingApprovals,
  getMyRequests,
  createRequest,
  actOnRequest,
  listDelegations,
  createDelegation,
  revokeDelegation,
};
