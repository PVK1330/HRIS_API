'use strict';

/**
 * Offline-transfer credentials verifier.
 *
 * There is no remote API to call; the "verification" is a sanity check
 * that the operator has filled in the minimum bank-detail fields a
 * customer would need in order to make a manual payment.
 */

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

async function verify(credentials = {}) {
  const { bank_name, account_number, account_holder } = credentials;
  const missing = [];
  if (!nonEmpty(bank_name))      missing.push('bank_name');
  if (!nonEmpty(account_number)) missing.push('account_number');
  if (!nonEmpty(account_holder)) missing.push('account_holder');

  if (missing.length > 0) {
    return {
      success: false,
      message: `Missing required bank details: ${missing.join(', ')}`,
    };
  }

  return { success: true, message: 'Offline transfer details look valid' };
}

module.exports = { verify };
