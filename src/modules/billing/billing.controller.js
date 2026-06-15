'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const stripeCheckout = require('./stripeCheckout.service');
const paypalCheckout = require('./paypalCheckout.service');

const createStripeCheckout = asyncHandler(async (req, res) => {
  const { tenantId, paymentId, planId, billingCycle, customerEmail } = req.body;
  const result = await stripeCheckout.createCheckoutSession({
    tenantId,
    paymentId,
    planId,
    billingCycle,
    customerEmail,
  });
  return ApiResponse.ok(res, result, 'Stripe Checkout session created');
});

const createPaypalCheckout = asyncHandler(async (req, res) => {
  const { tenantId, paymentId, planId, billingCycle, customerEmail } = req.body;
  if (!tenantId || !planId) {
    throw ApiError.badRequest('tenantId and planId are required');
  }

  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.ADMIN_URL?.replace(/\/superadmin.*$/, '') ||
    'http://localhost:5173'
  ).replace(/\/$/, '');

  // PayPal auto-appends ?token=ORDER_ID to the return URL — do not include it.
  const successUrl = `${frontendBase}/superadmin/tenants?paypal=success`;
  const cancelUrl  = `${frontendBase}/superadmin/tenants?paypal=cancelled`;

  const db = require('../../config/db');
  const plansRepo = require('../superadmin/plans.repository');
  const { getPlatformContext } = require('../../utils/platformSettings');
  const currencyService = require('../currency/currency.service');

  const plan = await plansRepo.findById(planId);
  if (!plan) throw ApiError.notFound('Plan not found');

  const platform = await getPlatformContext();
  const platformCurrency = (platform.currency || 'USD').toUpperCase();

  const cycle = String(billingCycle || 'monthly').toLowerCase() === 'annual' ? 'annual' : 'monthly';
  const amount = cycle === 'annual' ? Number(plan.annual_price) : Number(plan.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('This plan has no charge — PayPal Checkout is not required.');
  }

  let resolvedPaymentId = paymentId || null;
  if (!resolvedPaymentId) {
    try {
      const { rows } = await db.query(
        `SELECT id FROM public.payments WHERE tenant_id = $1 AND status <> 'completed' ORDER BY id DESC LIMIT 1`,
        [Number(tenantId)],
      );
      resolvedPaymentId = rows[0]?.id || null;
    } catch { resolvedPaymentId = null; }
  }

  const result = await paypalCheckout.createOrder({
    amount,
    currency:    platformCurrency,
    tenantId:    Number(tenantId),
    paymentId:   resolvedPaymentId,
    planId,
    billingCycle: cycle,
    successUrl,
    cancelUrl,
  });
  return ApiResponse.ok(res, result, 'PayPal checkout order created');
});

/** POST /billing/paypal/confirm — superadmin confirms/captures a PayPal order after approval. */
const confirmPaypalCheckout = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) throw ApiError.badRequest('orderId is required');

  const result = await paypalCheckout.captureOrder(orderId);
  if (result.paid && result.tenantId) {
    const tenantBillingService = require('./tenantBilling.service');
    await tenantBillingService.activateSubscription(result.tenantId, {
      via: 'paypal',
      reference: orderId,
      planId: result.planId,
    });
  }
  return ApiResponse.ok(res, result, result.paid ? 'PayPal payment confirmed.' : 'Payment not completed.');
});

module.exports = {
  createStripeCheckout,
  createPaypalCheckout,
  confirmPaypalCheckout,
};
