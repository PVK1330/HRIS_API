'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const attendanceSettingsService = require('./attendanceSettings.service');

// SECURITY: derive the tenant DB strictly from the authenticated JWT, not from the
// header-resolved req.tenant — defense-in-depth against cross-tenant access.
const tenantDb = (req) => req.user?.db_name || req.tenant?.dbName;

const getAttendanceSettings = asyncHandler(async (req, res) => {
  const data = await attendanceSettingsService.getAttendanceSettings(
    tenantDb(req),
    req.auth,
    req,
  );
  res.status(200).json({ success: true, data });
});

const updateAttendanceSettings = asyncHandler(async (req, res) => {
  const data = await attendanceSettingsService.updateAttendanceSettings(
    tenantDb(req),
    req.body,
    req.auth,
    req,
  );
  res.status(200).json({
    success: true,
    message: 'Attendance settings updated',
    data,
  });
});

module.exports = {
  getAttendanceSettings,
  updateAttendanceSettings,
};
