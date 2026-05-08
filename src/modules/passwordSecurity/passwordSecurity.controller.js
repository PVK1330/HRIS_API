'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const passwordSecurityService = require('./passwordSecurity.service');

const getPasswordSecuritySettings = asyncHandler(async (req, res) => {
  const data = await passwordSecurityService.getPasswordSecuritySettings(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const updatePasswordSecuritySettings = asyncHandler(async (req, res) => {
  const data = await passwordSecurityService.updatePasswordSecuritySettings(
    req.tenant.dbName,
    req.body
  );
  res.status(200).json({
    success: true,
    message: 'Password security settings updated',
    data,
  });
});

module.exports = {
  getPasswordSecuritySettings,
  updatePasswordSecuritySettings,
};
