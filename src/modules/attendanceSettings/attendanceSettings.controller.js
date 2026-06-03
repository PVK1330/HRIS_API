'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const attendanceSettingsService = require('./attendanceSettings.service');

const getAttendanceSettings = asyncHandler(async (req, res) => {
  const data = await attendanceSettingsService.getAttendanceSettings(
    req.tenant.dbName,
    req.auth,
    req,
  );
  res.status(200).json({ success: true, data });
});

const updateAttendanceSettings = asyncHandler(async (req, res) => {
  const data = await attendanceSettingsService.updateAttendanceSettings(
    req.tenant.dbName,
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
