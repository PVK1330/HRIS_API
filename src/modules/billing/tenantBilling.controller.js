'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./tenantBilling.service');

/** GET /tenant-billing/status — current org's trial/payment state (any tenant user). */
const getStatus = asyncHandler(async (req, res) => {
  if (!req.user?.tenant_id) throw ApiError.badRequest('No organization context');
  const billing = await service.getBillingForTenant(req.user.tenant_id);
  return ApiResponse.ok(res, billing, 'Billing status fetched.');
});

/** GET /tenant-billing/plans — active plans the org admin can choose from. */
const getPlans = asyncHandler(async (_req, res) => {
  const plans = await service.listPlans();
  return ApiResponse.ok(res, plans, 'Plans fetched.');
});

/** POST /tenant-billing/checkout — start a Stripe checkout for the org (org admin only). */
const checkout = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') {
    throw ApiError.forbidden('Only an organization admin can make a payment.');
  }
  const result = await service.createCheckoutForTenant(req.user.tenant_id, {
    planId: req.body.planId,
    billingCycle: req.body.billingCycle,
    customerEmail: req.user.email,
    returnPath: req.body.returnPath,
  });
  return ApiResponse.ok(res, result, 'Checkout session created.');
});

/** POST /tenant-billing/confirm — confirm a returned Stripe session and activate if paid. */
const confirm = asyncHandler(async (req, res) => {
  if (!req.user?.tenant_id) throw ApiError.badRequest('No organization context');
  const result = await service.confirmTenantCheckout(req.user.tenant_id, req.body.sessionId);
  return ApiResponse.ok(res, result, result.paid ? 'Payment confirmed.' : 'Payment not completed yet.');
});

/** POST /tenant-billing/:tenantId/activate — superadmin offline/manual mark-as-paid (optionally set a plan). */
const activate = asyncHandler(async (req, res) => {
  const billing = await service.activateSubscription(req.params.tenantId, {
    via: 'offline',
    reference: req.body.reference || null,
    planId: req.body.planId || null,
  });
  return ApiResponse.ok(res, billing, 'Subscription activated.');
});

module.exports = { getStatus, getPlans, checkout, confirm, activate };
