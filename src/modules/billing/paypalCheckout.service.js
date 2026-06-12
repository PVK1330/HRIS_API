'use strict';

/**
 * PayPal Orders v2 checkout — no SDK, raw REST API.
 *
 * Flow:
 *  1. createOrder  → returns { orderId, url }  (url = PayPal approval page)
 *  2. User approves at PayPal → PayPal redirects to successUrl?token=<orderId>&PayerID=<id>
 *  3. captureOrder(orderId) → returns { paid, status, tenantId, planId, billingCycle }
 *
 * Note: PayPal auto-appends ?token=ORDER_ID to the return_url. Do NOT include
 * {PAYPAL_ORDER_ID} placeholders in the URL — PayPal does not substitute them.
 */

const axios = require('axios');
const ApiError = require('../../utils/ApiError');
const gatewayRepo = require('../paymentGateways/paymentGateways.repository');

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE    = 'https://api-m.paypal.com';

async function getAccessToken(credentials, testMode) {
  const base = testMode ? SANDBOX_BASE : LIVE_BASE;
  const auth = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString('base64');
  const res = await axios.post(
    `${base}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );
  if (res.status >= 400 || !res.data?.access_token) {
    const detail = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
    throw ApiError.badRequest(
      `PayPal authentication failed: ${detail}. Verify your Client ID and Secret under Settings → Payment gateways.`,
    );
  }
  return { accessToken: res.data.access_token, base };
}

async function loadPaypalGateway() {
  const gw = await gatewayRepo.findBySlug('paypal');
  if (!gw || !gw.is_enabled) {
    throw ApiError.badRequest('PayPal is not enabled. Enable it under Settings → Payment gateways.');
  }
  const creds = gw.credentials || {};
  if (!creds.client_id || !creds.client_secret) {
    throw ApiError.badRequest('PayPal credentials are not configured. Add Client ID and Secret under Settings → Payment gateways.');
  }
  return { gw, creds, testMode: !!gw.test_mode };
}

/**
 * Create a PayPal CAPTURE order and return the user-facing approval URL.
 *
 * Custom data is serialised into purchase_unit.custom_id so it survives to
 * captureOrder without a DB round-trip.
 *
 * Return URL note: pass a clean URL (no {token} placeholder).
 * PayPal appends ?token=ORDER_ID automatically when the user approves.
 */
async function createOrder({
  amount,
  currency,
  tenantId,
  paymentId,
  planId,
  billingCycle,
  successUrl,
  cancelUrl,
}) {
  const { creds, testMode } = await loadPaypalGateway();
  const { accessToken, base } = await getAccessToken(creds, testMode);

  const customId = JSON.stringify({
    tenant_id:    String(tenantId),
    payment_id:   paymentId  ? String(paymentId)  : '',
    plan_id:      planId     ? String(planId)      : '',
    billing_cycle: billingCycle || 'monthly',
  });

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: String(currency).toUpperCase(),
          value: Number(amount).toFixed(2),
        },
        custom_id: customId,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          return_url:  successUrl,
          cancel_url:  cancelUrl,
          user_action: 'PAY_NOW',
        },
      },
    },
  };

  const res = await axios.post(`${base}/v2/checkout/orders`, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
      Accept:          'application/json',
    },
    timeout: 20_000,
    validateStatus: () => true,
  });

  const order = res.data;
  if (res.status >= 400) {
    const detail = (order?.details || []).map((d) => d.description || d.issue).join('; ')
      || order?.message
      || `HTTP ${res.status}`;
    throw ApiError.badRequest(`PayPal order creation failed: ${detail}`);
  }

  const approvalUrl = (order.links || []).find((l) => l.rel === 'approve')?.href
    || (order.links || []).find((l) => l.rel === 'payer-action')?.href;
  if (!approvalUrl) {
    throw ApiError.badRequest('PayPal did not return an approval link — verify your credentials and try again.');
  }

  return { orderId: order.id, url: approvalUrl };
}

/**
 * Capture an approved PayPal order and extract the custom metadata.
 */
async function captureOrder(orderId) {
  const { creds, testMode } = await loadPaypalGateway();
  const { accessToken, base } = await getAccessToken(creds, testMode);

  const res = await axios.post(
    `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        Accept:          'application/json',
      },
      timeout: 20_000,
      validateStatus: () => true,
    },
  );

  const order = res.data;
  if (res.status >= 400) {
    const detail = (order?.details || []).map((d) => d.description || d.issue).join('; ')
      || order?.message
      || `HTTP ${res.status}`;
    throw ApiError.badRequest(`PayPal capture failed: ${detail}`);
  }

  const paid = order.status === 'COMPLETED';
  const customId = order.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;
  let meta = {};
  try { meta = JSON.parse(customId || '{}'); } catch { meta = {}; }

  return {
    paid,
    status:      order.status,
    orderId:     order.id,
    tenantId:    meta.tenant_id    || null,
    planId:      meta.plan_id      || null,
    billingCycle: meta.billing_cycle || null,
  };
}

module.exports = { createOrder, captureOrder };
