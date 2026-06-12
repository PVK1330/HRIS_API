'use strict';

/**
 * Stripe webhook — the authoritative, signature-verified confirmation that a
 * checkout was paid. Previously activation depended entirely on the customer's
 * browser returning to the success URL and the SPA calling /confirm; if the tab
 * was closed (or the payment settled asynchronously) the tenant was never
 * activated even though Stripe took the money. This handler closes that gap.
 *
 * Mounted with a RAW body parser (see app.js) — signature verification must run
 * over the exact bytes Stripe sent, before express.json() parses them. Activation
 * is idempotent with the /confirm fast-path (activateSubscription just flips the
 * subscription to 'active'), so receiving both is safe.
 */

const gatewayRepo = require('../paymentGateways/paymentGateways.repository');
const tenantBilling = require('./tenantBilling.service');
const logger = require('../../utils/logger');

async function handleStripeWebhook(req, res) {
  let gw;
  try {
    gw = await gatewayRepo.findBySlug('stripe');
  } catch (err) {
    logger.error('[billing] stripe webhook: gateway lookup failed', { err: err.message });
    return res.status(500).send('gateway lookup failed');
  }

  const secret = gw && gw.credentials ? gw.credentials.webhook_secret : null;
  const secretKey = gw && gw.credentials ? gw.credentials.secret_key : null;
  if (!gw || !gw.is_enabled || !secret || !secretKey) {
    return res.status(503).send('Stripe webhook is not configured');
  }

  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  const stripe = new Stripe(String(secretKey).trim(), { apiVersion: '2024-06-20' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer (express.raw)
      req.headers['stripe-signature'],
      secret,
    );
  } catch (err) {
    logger.warn('[billing] stripe webhook signature verification failed', { err: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data && event.data.object ? event.data.object : {};
    const tenantId = session.metadata && session.metadata.tenant_id;
    if (session.payment_status === 'paid' && tenantId) {
      try {
        await tenantBilling.activateSubscription(tenantId, {
          via: 'stripe-webhook',
          reference: session.id,
          planId: (session.metadata && session.metadata.plan_id) || null,
        });
        logger.info('[billing] stripe webhook activated subscription', {
          tenantId,
          sessionId: session.id,
        });
      } catch (err) {
        // Return 5xx so Stripe retries delivery rather than dropping the event.
        logger.error('[billing] stripe webhook activation failed', { tenantId, err: err.message });
        return res.status(500).send('activation failed');
      }
    }
  }

  // Acknowledge all other event types so Stripe doesn't retry them.
  return res.json({ received: true });
}

module.exports = { handleStripeWebhook };
