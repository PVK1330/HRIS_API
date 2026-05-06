'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./tenant.service');

/**
 * POST /api/v1/tenants/create
 * Protected: superadmin only.
 * Body: { name, adminEmail, adminName, adminPassword, plan_id }
 */
const createTenant = asyncHandler(async (req, res) => {
  const { name, adminEmail, adminName, adminPassword, plan_id } = req.body;

  const tenant = await service.createTenant({
    name,
    adminEmail,
    adminName,
    adminPassword,
    plan_id,
    createdBy: req.user.id,
  });

  return ApiResponse.created(
    res,
    { tenant },
    'Tenant created successfully',
    { tenant }
  );
});

const getTenants = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;

  const result = await service.getAllTenants({ page, limit });
  return ApiResponse.ok(res, result, 'Tenants retrieved successfully');
});

const updateTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tenant = await service.updateTenant(id, req.body);
  return ApiResponse.ok(res, { tenant }, 'Tenant updated successfully');
});

const deleteTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await service.deleteTenant(id);
  return ApiResponse.ok(res, null, 'Tenant and its database deleted successfully');
});

const resetTenantPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  await service.resetTenantPassword(id, password);
  return ApiResponse.ok(res, null, 'Administrator password has been updated and emailed to the organization.');
});

const loginAsTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const authService = require('../auth/auth.service');

  const result = await authService.generateImpersonationToken(id);

  // Find tenant to get their domain
  const tenant = await service.getAllTenants().then(r => r.tenants.find(t => t.id === parseInt(id)));
  const slug = tenant.name.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');

  const baseDomain = req.hostname === 'localhost' ? 'localhost' : 'hris.cloud';
  const tenantUrl = `http://${slug}.${baseDomain}:5173/login?token=${result.token}&user=${encodeURIComponent(JSON.stringify(result.user))}`;

  return ApiResponse.ok(res, { loginUrl: tenantUrl }, 'Impersonation link generated');
});

module.exports = {
  createTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  resetTenantPassword,
  loginAsTenant,
};
