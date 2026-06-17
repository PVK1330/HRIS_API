'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const auditService = require('./audit.service');

/**
 * GET /api/v1/admin/audit/logs
 * Query params: module, action, status, actorEmployeeId, fromDate, toDate, search, page, limit
 */
const getLogs = asyncHandler(async (req, res) => {
  const {
    module,
    action,
    status,
    actorEmployeeId,
    fromDate,
    toDate,
    search,
    page,
    limit,
  } = req.query;

  const result = await auditService.getLogs(req.user.db_name, {
    module,
    action,
    status,
    actorEmployeeId,
    fromDate,
    toDate,
    search,
    page,
    limit,
  });

  return ApiResponse.ok(res, result, 'Audit logs retrieved successfully');
});

/**
 * GET /api/v1/admin/audit/modules
 * Returns distinct module names.
 */
const getModules = asyncHandler(async (req, res) => {
  const modules = await auditService.getModules(req.user.db_name);
  return ApiResponse.ok(res, modules, 'Modules retrieved successfully');
});

/**
 * GET /api/v1/admin/audit/actions
 * Query params: module (optional)
 */
const getActions = asyncHandler(async (req, res) => {
  const { module } = req.query;
  const actions = await auditService.getActions(req.user.db_name, module || null);
  return ApiResponse.ok(res, actions, 'Actions retrieved successfully');
});

module.exports = { getLogs, getModules, getActions };
