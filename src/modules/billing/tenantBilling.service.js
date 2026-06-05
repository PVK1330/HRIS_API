'use strict';

const { superAdminPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const plansRepo = require('../superadmin/plans.repository');
const tenantRepo = require('../tenant/tenant.repository');
const stripeCheckout = require('./stripeCheckout.service');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active plans the org admin can choose from on the payment page. */
async function listPlans() {
  const plans = await plansRepo.findAll({ isActive: true });
  return plans.map((p) => ({
    id: p.id,
    plan_name: p.plan_name,
    plan_code: p.plan_code,
    plan_description: p.plan_description,
    monthly_price: Number(p.monthly_price) || 0,
    annual_price: Number(p.annual_price) || 0,
    trial_days: p.trial_days,
    is_popular: !!p.is_popular,
  }));
}

/** Provisions a plan's features into tenant_access_controls (additive, best-effort). */
async function provisionPlanAccess(tenantId, planId) {
  try {
    const features = await plansRepo.getFeatures(planId);
    for (const f of features || []) {
      await tenantRepo.insertAccessControl(tenantId, planId, f.id);
    }
  } catch (err) {
    // Non-fatal: payment still succeeds even if feature provisioning hiccups.
    // eslint-disable-next-line no-console
    console.error('[tenantBilling] provisionPlanAccess failed:', err.message);
  }
}

/**
 * Pure computation of a tenant's access/billing state.
 *  - Paid (subscription_status 'active') → never gated.
 *  - Trial and still within trial_ends_at → full access, payment NOT required.
 *  - Trial expired (now > trial_ends_at) and unpaid → payment_required.
 *  - past_due / expired / cancelled → payment_required.
 */
function computeBillingState(tenant, plan) {
  const status = String(tenant.subscription_status || 'trial').toLowerCase();
  const trialEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
  const now = new Date();

  let paymentRequired = false;
  let trialActive = false;
  let daysLeft = null;

  if (status === 'active') {
    paymentRequired = false;
  } else if (status === 'trial') {
    if (trialEndsAt) {
      daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS);
      if (now.getTime() > trialEndsAt.getTime()) {
        paymentRequired = true;
      } else {
        trialActive = true;
      }
    } else {
      // No trial end recorded → treat as an open trial (not gated).
      trialActive = true;
    }
  } else {
    // past_due / expired / cancelled / suspended
    paymentRequired = true;
  }

  return {
    subscription_status: status,
    trial_ends_at: tenant.trial_ends_at || null,
    trial_active: trialActive,
    days_left: daysLeft,
    payment_required: paymentRequired,
    plan_id: tenant.plan_id || null,
    plan_name: plan?.plan_name || null,
    monthly_price: plan ? Number(plan.monthly_price) : null,
    annual_price: plan ? Number(plan.annual_price) : null,
  };
}

async function loadTenant(tenantId) {
  const { rows } = await superAdminPool.query(
    `SELECT id, name, db_name, status, plan_id, subscription_status, trial_ends_at
     FROM public.tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  return rows[0] || null;
}

/** Billing state for a tenant id (used by auth + the tenant billing API). */
async function getBillingForTenant(tenantId) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found');
  let plan = null;
  if (tenant.plan_id) {
    try {
      plan = await plansRepo.findById(tenant.plan_id);
    } catch {
      plan = null;
    }
  }
  return computeBillingState(tenant, plan);
}

/**
 * Marks a tenant's subscription active (paid). Used by Stripe confirmation and by
 * the superadmin offline/manual "mark as paid" action.
 */
async function activateSubscription(tenantId, { via = 'manual', reference = null, planId = null } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found');

  // If the org chose/confirmed a specific plan, record it and unlock its features.
  if (planId != null && String(planId) !== '' && String(planId) !== String(tenant.plan_id)) {
    await superAdminPool.query(
      `UPDATE public.tenants SET plan_id = $1 WHERE id = $2`,
      [String(planId), tenantId],
    );
    await provisionPlanAccess(tenantId, planId);
  }

  await superAdminPool.query(
    `UPDATE public.tenants SET subscription_status = 'active' WHERE id = $1`,
    [tenantId],
  );

  // Best-effort: flip tenant_subscriptions + the latest pending payment to completed.
  await superAdminPool
    .query(
      `UPDATE public.tenant_subscriptions SET status = 'active' WHERE tenant_id = $1`,
      [tenantId],
    )
    .catch(() => {});
  await superAdminPool
    .query(
      `UPDATE public.payments
         SET status = 'completed',
             notes = COALESCE(notes, '') || $2
       WHERE id = (
         SELECT id FROM public.payments
         WHERE tenant_id = $1 AND status <> 'completed'
         ORDER BY id DESC LIMIT 1
       )`,
      [tenantId, ` | Activated via ${via}${reference ? ` (${reference})` : ''}`],
    )
    .catch(() => {});

  return getBillingForTenant(tenantId);
}

/**
 * Sanitises a caller-supplied return path so it can only point back into the
 * org (admin) area — never the superadmin panel or an external site.
 * Falls back to the dedicated payment page.
 */
function safeAdminReturnPath(returnPath) {
  const fallback = '/admin/payment';
  if (typeof returnPath !== 'string') return fallback;
  const p = returnPath.trim();
  // Must be a same-origin absolute path inside /admin (block //evil.com, http://, /superadmin, …).
  if (!/^\/admin(\/|\?|$)/.test(p) || p.startsWith('//')) return fallback;
  // Drop any stripe params the page may already carry to avoid stacking them.
  return p.replace(/([?&])stripe=[^&]*(&|$)/g, '$1').replace(/([?&])session_id=[^&]*(&|$)/g, '$1').replace(/[?&]$/, '');
}

/** Appends query params to a path, choosing ? or & based on whether one already exists. */
function withQuery(path, query) {
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

/** Creates a Stripe Checkout session for the chosen (or assigned) plan and returns the URL. */
async function createCheckoutForTenant(tenantId, { planId, billingCycle = 'monthly', customerEmail, returnPath } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found');

  // Use the plan the admin selected on the payment page; fall back to the assigned plan.
  let chosenPlanId = planId != null && String(planId) !== '' ? String(planId) : tenant.plan_id;
  if (chosenPlanId) {
    const plan = await plansRepo.findById(chosenPlanId).catch(() => null);
    if (!plan || plan.is_active === false) {
      throw ApiError.badRequest('Selected plan is not available. Please choose another plan.');
    }
  }
  if (!chosenPlanId) {
    throw ApiError.badRequest('Please select a plan to continue.');
  }

  const base = (
    process.env.FRONTEND_URL ||
    process.env.ADMIN_URL?.replace(/\/superadmin.*$/, '') ||
    'http://localhost:5173'
  ).replace(/\/$/, '');

  // Find an existing pending payment to attach the session to (optional).
  let paymentId = null;
  try {
    const { rows } = await superAdminPool.query(
      `SELECT id FROM public.payments
       WHERE tenant_id = $1 AND status <> 'completed'
       ORDER BY id DESC LIMIT 1`,
      [tenantId],
    );
    paymentId = rows[0]?.id || null;
  } catch {
    paymentId = null;
  }

  // Return the org admin to the page they paid from (defaults to /admin/payment).
  const ret = safeAdminReturnPath(returnPath);
  return stripeCheckout.createCheckoutSession({
    tenantId,
    paymentId,
    planId: chosenPlanId,
    billingCycle,
    customerEmail,
    successUrl: `${base}${withQuery(ret, 'stripe=success&session_id={CHECKOUT_SESSION_ID}')}`,
    cancelUrl: `${base}${withQuery(ret, 'stripe=cancelled')}`,
  });
}

/** Confirms a returned Stripe session and activates the subscription if paid. */
async function confirmTenantCheckout(tenantId, sessionId) {
  if (!sessionId) throw ApiError.badRequest('Missing session id');
  const result = await stripeCheckout.retrieveSession(sessionId);

  // Guard: the session must belong to this tenant.
  if (result.metadata?.tenant_id && String(result.metadata.tenant_id) !== String(tenantId)) {
    throw ApiError.badRequest('This payment session does not belong to your organization.');
  }

  if (!result.paid) {
    return { paid: false, billing: await getBillingForTenant(tenantId) };
  }

  const billing = await activateSubscription(tenantId, {
    via: 'stripe',
    reference: sessionId,
    planId: result.metadata?.plan_id || null,
  });
  return { paid: true, billing };
}

module.exports = {
  computeBillingState,
  getBillingForTenant,
  activateSubscription,
  createCheckoutForTenant,
  confirmTenantCheckout,
  listPlans,
};
