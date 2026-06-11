'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./superadmin.service');
const authService = require('../auth/auth.service');
const env = require('../../config/env');

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

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
      { mfaRequired: true, mfaToken: result.mfaToken, email: result.email },
      'Two-factor authentication required'
    );
  }

  const { refreshToken, token, superadmin } = result;
  if (refreshToken) setRefreshCookie(res, refreshToken);

  return ApiResponse.ok(res, { token, superadmin }, 'Login successful');
});

/**
 * POST /api/v1/superadmin/verify-2fa
 */
const verify2FA = asyncHandler(async (req, res) => {
  const { mfaToken, code } = req.body;

  const { refreshToken, token, superadmin } = await service.verify2FA({ mfaToken, code });
  if (refreshToken) setRefreshCookie(res, refreshToken);

  return ApiResponse.ok(res, { token, superadmin }, 'Verification successful');
});

/**
 * POST /api/v1/superadmin/logout
 */
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  await authService.revokeRefreshToken(token);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  return ApiResponse.ok(res, null, 'Logged out successfully.');
});

/* --- Self-service 2FA enrollment for superadmin / sub-admin accounts --- */

const getMfaStatus = asyncHandler(async (req, res) => {
  const result = await service.getMfaStatus(req.user.id);
  return ApiResponse.ok(res, result, 'MFA status fetched');
});

const setupMfa = asyncHandler(async (req, res) => {
  const result = await service.beginMfaSetup(req.user.id);
  return ApiResponse.ok(res, result, 'Scan the QR code with your authenticator app');
});

const enableMfa = asyncHandler(async (req, res) => {
  const result = await service.enableMfa(req.user.id, req.body.code);
  return ApiResponse.ok(res, result, 'Two-factor authentication enabled');
});

const disableMfa = asyncHandler(async (req, res) => {
  const result = await service.disableMfa(req.user.id, req.body.code);
  return ApiResponse.ok(res, result, 'Two-factor authentication disabled');
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

/**
 * GET /api/v1/superadmin/profile
 * Returns the authenticated superadmin's own profile.
 */
const getProfile = asyncHandler(async (req, res) => {
  const profile = await service.getProfile(req.user.id);
  return ApiResponse.ok(res, { profile }, 'Profile retrieved successfully');
});

/**
 * PUT /api/v1/superadmin/profile
 * Updates the authenticated superadmin's own profile (name).
 */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await service.updateProfile(req.user.id, req.body);
  await service.logAuditEvent({
    actorName: profile.name || req.user?.email || 'Super Admin',
    action: 'ProfileUpdated',
    target: profile.email,
    ipAddress: req.ip,
  });
  return ApiResponse.ok(res, { profile }, 'Profile updated successfully');
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

const deleteRole = asyncHandler(async (req, res) => {
  await service.deleteRole(req.params.roleKey);
  return ApiResponse.ok(res, null, 'Role deleted successfully');
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
  await service.logAuditEvent({
    actorName: req.user?.name || req.user?.email || 'Super Admin',
    action: 'AnnouncementCreated',
    target: announcement.title,
    ipAddress: req.ip,
  });
  return ApiResponse.created(res, { announcement }, 'Announcement created successfully');
});

const updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await service.updateAnnouncement(req.params.id, req.body);
  await service.logAuditEvent({
    actorName: req.user?.name || req.user?.email || 'Super Admin',
    action: 'AnnouncementUpdated',
    target: announcement.title,
    ipAddress: req.ip,
  });
  return ApiResponse.ok(res, { announcement }, 'Announcement updated successfully');
});

const deleteAnnouncement = asyncHandler(async (req, res) => {
  await service.deleteAnnouncement(req.params.id);
  await service.logAuditEvent({
    actorName: req.user?.name || req.user?.email || 'Super Admin',
    action: 'AnnouncementDeleted',
    target: `Announcement#${req.params.id}`,
    ipAddress: req.ip,
  });
  return ApiResponse.ok(res, null, 'Announcement deleted successfully');
});

const getSupportTickets = asyncHandler(async (_req, res) => {
  const tickets = await service.getSupportTickets();
  return ApiResponse.ok(res, { tickets }, 'Support tickets retrieved successfully');
});

const updateSupportTicket = asyncHandler(async (req, res) => {
  const ticket = await service.updateSupportTicket(req.params.id, req.body);
  await service.logAuditEvent({
    actorName: req.user?.name || req.user?.email || 'Super Admin',
    action: 'SupportTicketUpdated',
    target: ticket.ticket_code || `Ticket#${ticket.id}`,
    ipAddress: req.ip,
    metadata: req.body,
  });
  return ApiResponse.ok(res, { ticket }, 'Support ticket updated successfully');
});

const addSupportTicketMessage = asyncHandler(async (req, res) => {
  const ticket = await service.addSupportTicketMessage(req.params.id, req.body);
  await service.logAuditEvent({
    actorName: req.user?.name || req.user?.email || 'Super Admin',
    action: 'SupportTicketReplied',
    target: ticket.ticket_code || `Ticket#${ticket.id}`,
    ipAddress: req.ip,
  });
  return ApiResponse.ok(res, { ticket }, 'Support ticket message added successfully');
});

const getAuditLogs = asyncHandler(async (_req, res) => {
  const logs = await service.getAuditLogs();
  return ApiResponse.ok(res, { logs }, 'Audit logs retrieved successfully');
});

module.exports = {
  login,
  verify2FA,
  logout,
  getMfaStatus,
  setupMfa,
  enableMfa,
  disableMfa,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  getProfile,
  updateProfile,
  getPermissions,
  createRole,
  updateRole,
  deleteRole,
  getModules,
  updateModule,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getSupportTickets,
  updateSupportTicket,
  addSupportTicketMessage,
  getAuditLogs,
};
