'use strict';

const axios = require('axios');

/**
 * PayPal credentials verifier.
 *
 * No SDK — exchanges client_id/client_secret for an OAuth2 access token
 * against the appropriate (sandbox vs live) endpoint. A 200 response means
 * the credentials are accepted by PayPal; 401 means they aren't.
 */

const SANDBOX_URL = 'https://api.sandbox.paypal.com/v1/oauth2/token';
const LIVE_URL    = 'https://api.paypal.com/v1/oauth2/token';

async function verify({ client_id, client_secret, mode } = {}, { testMode } = {}) {
  if (!client_id || !client_secret) {
    return { success: false, message: 'PayPal client_id and client_secret are required' };
  }

  const useSandbox = mode === 'sandbox' || testMode === true;
  const url = useSandbox ? SANDBOX_URL : LIVE_URL;
  const auth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

  try {
    const res = await axios.post(
      url,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10_000,
        validateStatus: () => true,
      }
    );

    if (res.status === 200 && res.data && res.data.access_token) {
      return { success: true, message: 'PayPal credentials verified successfully' };
    }
    if (res.status === 401) {
      return { success: false, message: 'Invalid PayPal client ID or secret' };
    }
    const detail =
      (res.data && (res.data.error_description || res.data.error)) ||
      `PayPal returned HTTP ${res.status}`;
    return { success: false, message: detail };
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : 'PayPal verification failed',
    };
  }
}

module.exports = { verify };
