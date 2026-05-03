'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./tenant.service');

/**
 * POST /api/v1/tenants/create
 * Protected: superadmin only.
 * Body: { name, adminEmail, adminName, adminPassword }
 */
const createTenant = asyncHandler(async (req, res) => {
  const { name, adminEmail, adminName, adminPassword } = req.body;

  const tenant = await service.createTenant({
    name,
    adminEmail,
    adminName,
    adminPassword,
    createdBy: req.user.id,
  });

  return ApiResponse.created(
    res,
    { tenant },
    'Tenant created successfully',
    { tenant }
  );
});

module.exports = {
  createTenant,
};
