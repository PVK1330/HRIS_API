'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./rbac.service');

const listPermissions = asyncHandler(async (req, res) => {
  const data = await service.listPermissions(req);
  return ApiResponse.ok(res, data, 'Permissions retrieved successfully');
});

const listAvailablePermissions = asyncHandler(async (req, res) => {
  const data = await service.listPermissions(req);
  return ApiResponse.ok(res, data, 'Permissions retrieved successfully');
});

const listRoles = asyncHandler(async (req, res) => {
  const data = await service.listRoles(req);
  return ApiResponse.ok(res, data, 'Roles retrieved successfully');
});

const createRole = asyncHandler(async (req, res) => {
  const role = await service.createRole(req);
  return ApiResponse.created(res, role, 'Role created successfully');
});

const updateRolePermissions = asyncHandler(async (req, res) => {
  const role = await service.updateRolePermissions(req);
  return ApiResponse.ok(res, role, 'Role permissions updated');
});

const deleteRole = asyncHandler(async (req, res) => {
  await service.deleteRole(req);
  return ApiResponse.ok(res, null, 'Role deleted successfully');
});

module.exports = {
  listPermissions,
  listAvailablePermissions,
  listRoles,
  createRole,
  updateRolePermissions,
  deleteRole,
};
