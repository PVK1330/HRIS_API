'use strict';

const ApiError = require('../../utils/ApiError');
const gatewayRepo = require('../paymentGateways/paymentGateways.repository');
const plansRepo = require('../superadmin/plans.repository');
const currencyService = require('../currency/currency.service');
const db = require('../../config/db');
const { formatDate } = require('../../utils/timezone');
const {
  getPlatformContext,
  stripeLocaleForTimezone,
} = require('../../utils/platformSettings');

function getStripeClient(secretKey) {
  if (!secretKey || String(secretKey).trim() === '') {
    throw ApiError.badRequest('Stripe secret key is not configured. Add it under Settings → Payment gateways.');
  }
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  return new Stripe(String(secretKey).trim(), { apiVersion: '2024-06-20' });
}

// Stripe's minimum chargeable amount per currency, in that currency's major unit.
// Stripe ALSO enforces this against the account's settlement currency after
// converting the presentment amount — so this map only catches the obvious
// "too small in its own currency" case. The cross-currency case (e.g. an INR
// price charged on an AED-settling account) is caught by translateStripeError().
const STRIPE_MIN_CHARGE = {
  usd: 0.5, eur: 0.5, gbp: 0.3, aed: 2, sar: 2, qar: 2,
  inr: 0.5, aud: 0.5, cad: 0.5, sgd: 0.5, nzd: 0.5, chf: 0.5, brl: 0.5,
  dkk: 2.5, nok: 3, sek: 3, pln: 2, ron: 2, bgn: 1, czk: 15,
  hkd: 4, huf: 175, jpy: 50, mxn: 10, myr: 2, thb: 10,
};

/** Fast pre-flight: reject before calling Stripe when the total is below the
 *  presentment currency's own minimum. (Skips currencies we don't have a min for.) */
function assertAboveStripeMinimum(total, currency) {
  const code = String(currency).toLowerCase();
  const min = STRIPE_MIN_CHARGE[code];
  const upper = code.toUpperCase();
  if (min != null && Number(total) < min) {
    throw ApiError.badRequest(
      `The amount (${Number(total).toFixed(2)} ${upper}) is below the minimum the payment `
        + `provider can charge (${min} ${upper}). Please choose a plan priced at or above this amount.`,
    );
  }
}

function isStripeMinimumError(err) {
  if (!err) return false;
  if (err.code === 'amount_too_small') return true;
  return /must convert to at least|amount must be at least|amount_too_small/i.test(String(err.message || ''));
}

/** Translates Stripe's minimum-amount rejection (incl. the cross-currency
 *  "must convert to at least N fils" case) into a clean, actionable error. */
function translateStripeError(err) {
  if (isStripeMinimumError(err)) {
    return ApiError.badRequest(
      'This payment could not be started because the amount is below the minimum the connected '
        + 'Stripe account accepts for its settlement currency. This usually means the plan price '
        + 'or its currency does not match the Stripe account. '
        + `(Provider detail: ${err.message})`,
    );
  }
  return err;
}

function resolveFrontendBase() {
  return (
    process.env.FRONTEND_URL ||
    process.env.ADMIN_URL?.replace(/\/superadmin.*$/, '') ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
}

/**
 * Create a Stripe Checkout session for a pending tenant onboarding payment.
 */
async function createCheckoutSession({
  tenantId,
  paymentId,
  planId,
  billingCycle = 'monthly',
  customerEmail,
  successUrl,
  cancelUrl,
}) {
  const gw = await gatewayRepo.findBySlug('stripe');
  if (!gw || !gw.is_enabled) {
    throw ApiError.badRequest('Stripe is not enabled. Enable it in Settings → Payment gateways.');
  }

  const secretKey = gw.credentials?.secret_key;
  const stripe = getStripeClient(secretKey);

  const plan = await plansRepo.findById(planId);
  if (!plan) throw ApiError.notFound('Plan not found');

  const platform = await getPlatformContext();
  const platformTz = platform.timezone;

  const cycle = String(billingCycle || 'monthly').toLowerCase() === 'annual' ? 'annual' : 'monthly';
  const amount = cycle === 'annual' ? Number(plan.annual_price) : Number(plan.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('This plan has no charge — Stripe checkout is not required.');
  }

  let paymentRow = null;
  if (paymentId) {
    const { rows } = await db.query(
      `SELECT id, tenant_id, amount, currency, status FROM public.payments WHERE id = $1::integer`,
      [Number(paymentId)],
    );
    paymentRow = rows[0];
    if (!paymentRow) throw ApiError.notFound('Payment record not found');
    if (Number(paymentRow.tenant_id) !== Number(tenantId)) {
      throw ApiError.badRequest('Payment does not belong to this tenant');
    }
  }

  // Plans are priced in the platform's base currency — always use that for
  // Stripe, not the payment record's currency which may be stale or wrong.
  const platformCurrency = (platform.currency || 'AED').toUpperCase();
  const base = resolveFrontendBase();
  const currency = platformCurrency.toLowerCase();
  const invoiceDate = formatDate(new Date(), platformTz, 'DD/MM/YYYY');

  // Billing tax (VAT/GST) is added on top of the plan price as a separate line.
  const currencySettings = await currencyService.getCurrencySettings().catch(() => null);
  const taxAmount = currencySettings ? currencyService.taxFor(amount, currencySettings) : 0;
  const taxLabel = currencySettings?.taxLabel || 'Tax';
  const taxRate = Number(currencySettings?.taxRate) || 0;

  // Fail fast with a clean message if the grand total is below the provider minimum
  // for the presentment currency (Stripe also re-checks this after converting to the
  // account's settlement currency — that case is handled at the create() call below).
  assertAboveStripeMinimum(amount + taxAmount, currency);

  const lineItems = [
    {
      price_data: {
        currency,
        unit_amount: Math.round(amount * 100),
        product_data: {
          name: `${plan.plan_name} subscription`,
          description: `${cycle === 'annual' ? 'Annual' : 'Monthly'} billing (${invoiceDate}, ${platformTz})`,
        },
      },
      quantity: 1,
    },
  ];

  if (taxAmount > 0) {
    lineItems.push({
      price_data: {
        currency,
        unit_amount: Math.round(taxAmount * 100),
        product_data: {
          name: `${taxLabel} (${taxRate}%)`,
          description: `${taxLabel} on ${plan.plan_name} subscription`,
        },
      },
      quantity: 1,
    });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: stripeLocaleForTimezone(platformTz),
      customer_email: customerEmail || undefined,
      line_items: lineItems,
      success_url: successUrl || `${base}/superadmin/tenants?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${base}/superadmin/tenants?stripe=cancelled`,
      metadata: {
        tenant_id: String(tenantId),
        payment_id: paymentId ? String(paymentId) : '',
        plan_id: String(planId),
        billing_cycle: cycle,
        platform_timezone: platformTz,
        platform_currency: platformCurrency,
        subtotal: amount.toFixed(2),
        tax_label: taxLabel,
        tax_rate: String(taxRate),
        tax_amount: taxAmount.toFixed(2),
        total: (amount + taxAmount).toFixed(2),
      },
    });
  } catch (err) {
    throw translateStripeError(err);
  }

  if (paymentId && session.id) {
    const sessionRef = String(session.id);
    await db.query(
      `UPDATE public.payments
       SET payment_reference = $1::varchar,
           notes = COALESCE(notes, '') || ' | Stripe session ' || $2::text
       WHERE id = $3::integer`,
      [sessionRef, sessionRef, Number(paymentId)],
    );
  }

  return {
    url: session.url,
    sessionId: session.id,
  };
}

/**
 * Retrieve a Checkout Session to confirm payment status (paid / unpaid).
 * Returns { paid, payment_status, metadata }.
 */
async function retrieveSession(sessionId) {
  const gw = await gatewayRepo.findBySlug('stripe');
  if (!gw || !gw.is_enabled) {
    throw ApiError.badRequest('Stripe is not enabled.');
  }
  const stripe = getStripeClient(gw.credentials?.secret_key);
  const session = await stripe.checkout.sessions.retrieve(String(sessionId));
  return {
    paid: session.payment_status === 'paid',
    payment_status: session.payment_status,
    metadata: session.metadata || {},
    amount_total: session.amount_total,
    currency: session.currency,
  };
}

module.exports = {
  createCheckoutSession,
  retrieveSession,
};
