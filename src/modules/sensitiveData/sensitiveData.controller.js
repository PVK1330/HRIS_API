'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const sensitiveDataService = require('./sensitiveData.service');

const getSensitiveDataSettings = asyncHandler(async (req, res) => {
  const data = await sensitiveDataService.getSensitiveDataSettings(req.tenant.dbName);
  res.status(200).json({ success: true, data });
});

const updateSensitiveDataSettings = asyncHandler(async (req, res) => {
  const payload = await sensitiveDataService.updateSensitiveDataSettings(
    req.tenant.dbName,
    req.body
  );
  const { message, settings, ...rest } = payload;
  res.status(200).json({
    success: true,
    message: message || 'Sensitive data settings updated',
    data: {
      settings,
      salaryVisibilityOptions: rest.salaryVisibilityOptions,
      visaVisibilityOptions: rest.visaVisibilityOptions,
      documentVisibilityOptions: rest.documentVisibilityOptions,
      notesVisibilityOptions: rest.notesVisibilityOptions,
      roles: rest.roles,
    },
  });
});

module.exports = {
  getSensitiveDataSettings,
  updateSensitiveDataSettings,
};
