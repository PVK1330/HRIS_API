'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const leaveSettingsService = require('./leaveSettings.service');

const getAll = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.getAllLeaveTypes(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.getLeaveTypeById(req.tenant.dbName, req.params.id);
  res.status(200).json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.createLeaveType(req.tenant.dbName, req.body);
  res.status(201).json({ success: true, message: 'Leave type created', data });
});

const update = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.updateLeaveType(
    req.tenant.dbName,
    req.params.id,
    req.body
  );
  res.status(200).json({ success: true, message: 'Leave type updated', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await leaveSettingsService.deleteLeaveType(req.tenant.dbName, req.params.id);
  res.status(200).json({ success: true, message: 'Leave type deleted', data });
});

module.exports = {
  getAll,
  getOne,
  create,
  update,
  remove,
};
