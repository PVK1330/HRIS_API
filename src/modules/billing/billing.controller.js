'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const stripeCheckout = require('./stripeCheckout.service');

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

module.exports = {
  createStripeCheckout,
};
