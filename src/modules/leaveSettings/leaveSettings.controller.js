'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const leaveSettingsService = require('./leaveSettings.service');

// SECURITY: derive the tenant DB strictly from the authenticated JWT, not from the
// header-resolved req.tenant — defense-in-depth against cross-tenant access.
const tenantDb = (req) => req.user?.db_name || req.tenant?.dbName;

const getAll = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.getAllLeaveTypes(tenantDb(req));
  res.status(200).json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.getLeaveTypeById(tenantDb(req), req.params.id);
  res.status(200).json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.createLeaveType(tenantDb(req), req.body);
  res.status(201).json({ success: true, message: 'Leave type created', data });
});

const update = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.updateLeaveType(
    tenantDb(req),
    req.params.id,
    req.body
  );
  res.status(200).json({ success: true, message: 'Leave type updated', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.deleteLeaveType(tenantDb(req), req.params.id);
  res.status(200).json({ success: true, message: 'Leave type deleted', data });
});

module.exports = {
  getAll,
  getOne,
  create,
  update,
  remove,
};
