'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./superadmin.service');

/**
 * POST /api/v1/superadmin/login
 * Body: { email, password }
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await service.login({ email, password });

  if (result.mfaRequired) {
    return ApiResponse.ok(
      res,
      { mfaRequired: true, userId: result.userId, email: result.email },
      'Two-factor authentication required'
    );
  }

  const { token, superadmin } = result;

  return ApiResponse.ok(
    res,
    { token, superadmin },
    'Login successful'
  );
});

/**
 * POST /api/v1/superadmin/verify-2fa
 */
const verify2FA = asyncHandler(async (req, res) => {
  const { userId, code } = req.body;

  const { token, superadmin } = await service.verify2FA({ userId, code });

  return ApiResponse.ok(
    res,
    { token, superadmin },
    'Verification successful'
  );
});

const getAdminUsers = asyncHandler(async (_req, res) => {
  const users = await service.getAdminUsers();
  return ApiResponse.ok(res, { users }, 'Admin users retrieved successfully');
});

const createAdminUser = asyncHandler(async (req, res) => {
  const user = await service.createAdminUser(req.body);
  return ApiResponse.created(res, { user }, 'Admin user created successfully');
});

const updateAdminUser = asyncHandler(async (req, res) => {
  const user = await service.updateAdminUser(req.params.id, req.body);
  return ApiResponse.ok(res, { user }, 'Admin user updated successfully');
});

const getPermissions = asyncHandler(async (_req, res) => {
  const roles = await service.getRoles();
  return ApiResponse.ok(res, { roles }, 'Permissions retrieved successfully');
});

const createRole = asyncHandler(async (req, res) => {
  const role = await service.createRole(req.body);
  return ApiResponse.created(res, { role }, 'Role created successfully');
});

const updateRole = asyncHandler(async (req, res) => {
  const role = await service.updateRole(req.params.roleKey, req.body);
  return ApiResponse.ok(res, { role }, 'Role updated successfully');
});

const getModules = asyncHandler(async (_req, res) => {
  const modules = await service.getModules();
  return ApiResponse.ok(res, { modules }, 'Modules retrieved successfully');
});

const updateModule = asyncHandler(async (req, res) => {
  const moduleItem = await service.updateModule(req.params.moduleKey, req.body);
  return ApiResponse.ok(res, { module: moduleItem }, 'Module updated successfully');
});

const getAnnouncements = asyncHandler(async (_req, res) => {
  const announcements = await service.getAnnouncements();
  return ApiResponse.ok(res, { announcements }, 'Announcements retrieved successfully');
});

const createAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await service.createAnnouncement(req.body);
  return ApiResponse.created(res, { announcement }, 'Announcement created successfully');
});

const updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await service.updateAnnouncement(req.params.id, req.body);
  return ApiResponse.ok(res, { announcement }, 'Announcement updated successfully');
});

const deleteAnnouncement = asyncHandler(async (req, res) => {
  await service.deleteAnnouncement(req.params.id);
  return ApiResponse.ok(res, null, 'Announcement deleted successfully');
});

module.exports = {
  login,
  verify2FA,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  getPermissions,
  createRole,
  updateRole,
  getModules,
  updateModule,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
