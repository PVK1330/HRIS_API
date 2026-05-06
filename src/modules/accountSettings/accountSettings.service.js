'use strict';

const ApiError = require('../../utils/ApiError');
const repo = require('./accountSettings.repository');

function mapRow(row) {
  if (!row) return null;
  return {
    publicRegistration: !!row.public_registration,
    emailVerification: !!row.email_verification,
    twoFactorAuth: !!row.two_factor_auth,
  };
}

function assertBoolean(name, value) {
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `${name} must be boolean`);
  }
}

async function getAccountSettings() {
  const row = await repo.getAccountSettings(null);
  if (!row) {
    throw new ApiError(500, 'Account settings not initialized');
  }
  return mapRow(row);
}

/**
 * @param {{ publicRegistration?: boolean, emailVerification?: boolean, twoFactorAuth?: boolean }} input
 */
async function updateAccountSettings(input) {
  const body = input || {};
  assertBoolean('publicRegistration', body.publicRegistration);
  assertBoolean('emailVerification', body.emailVerification);
  assertBoolean('twoFactorAuth', body.twoFactorAuth);

  const updated = await repo.updateAccountSettings(null, {
    publicRegistration: body.publicRegistration,
    emailVerification: body.emailVerification,
    twoFactorAuth: body.twoFactorAuth,
  });
  if (!updated) {
    throw new ApiError(500, 'Account settings not initialized');
  }
  return mapRow(updated);
}

module.exports = {
  getAccountSettings,
  updateAccountSettings,
};
