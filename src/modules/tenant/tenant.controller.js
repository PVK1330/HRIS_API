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
  const {
    name,
    adminEmail,
    adminName,
    adminPassword,
    plan_id,
    billing_cycle,
    payment_gateway,
    payment_collection,
    payment_reference,
  } = req.body;

  const tenant = await service.createTenant({
    name,
    adminEmail,
    adminName,
    adminPassword,
    plan_id,
    billing_cycle,
    payment_gateway,
    payment_collection,
    payment_reference,
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
  const { search, plan, status } = req.query;

  const result = await service.getAllTenants({ page, limit, search, plan, status });
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
  const repo = require('./tenant.repository');

  const code = await authService.issueImpersonationCode(id);
  const tenant = await repo.findTenantById(Number(id));
  const { slugifyTenantName } = require('../../utils/tenantSlug');
  const slug = slugifyTenantName(tenant.name);

  const host = req.hostname || '';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const baseDomain = isLocalHost
    ? 'localhost'
    : host.split('.').slice(-2).join('.');
  const tenantOrigin = isLocalHost
    ? `${req.protocol}://${slug}.localhost:5173`
    : `https://${slug}.${baseDomain}`;
  const tenantUrl = `${tenantOrigin}/login?impersonation_code=${code}`;

  return ApiResponse.ok(res, { loginUrl: tenantUrl }, 'Impersonation link generated');
});

const getTenantFeatures = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const features = await service.getTenantFeatures(id);
  return ApiResponse.ok(res, { features }, 'Tenant features retrieved successfully');
});

const updateTenantFeature = asyncHandler(async (req, res) => {
  const { id, featureId } = req.params;
  const { isEnabled } = req.body;

  const access = await service.updateTenantFeature(id, featureId, isEnabled);
  return ApiResponse.ok(res, { access }, 'Tenant feature updated successfully');
});

module.exports = {
  createTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  resetTenantPassword,
  loginAsTenant,
  getTenantFeatures,
  updateTenantFeature,
};
