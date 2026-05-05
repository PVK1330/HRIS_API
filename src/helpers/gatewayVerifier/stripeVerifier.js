'use strict';

/**
 * Stripe credentials verifier.
 *
 * Hits the live Stripe API with the supplied secret_key. A trivial call
 * (paymentMethods.list) is sufficient to know whether the key is valid;
 * a 200 means the key works, AuthenticationError means it doesn't.
 *
 * Always returns a result object — never throws.
 */

let StripeCtor = null;
try {
  // Lazy-loaded so the rest of the system still boots if stripe isn't installed.
  // eslint-disable-next-line global-require
  StripeCtor = require('stripe');
} catch (_) {
  StripeCtor = null;
}

async function verify({ secret_key } = {}) {
  if (!secret_key || typeof secret_key !== 'string' || secret_key.trim() === '') {
    return { success: false, message: 'Stripe secret key is required' };
  }
  if (!StripeCtor) {
    return { success: false, message: 'Stripe SDK is not installed on the server' };
  }

  try {
    const stripe = StripeCtor(secret_key, { apiVersion: '2024-06-20' });
    await stripe.paymentMethods.list({ limit: 1 });
    return { success: true, message: 'Stripe credentials verified successfully' };
  } catch (err) {
    if (err && (err.type === 'StripeAuthenticationError' || err.code === 'authentication_required')) {
      return { success: false, message: 'Invalid Stripe secret key' };
    }
    return { success: false, message: err && err.message ? err.message : 'Stripe verification failed' };
  }
}

module.exports = { verify };
