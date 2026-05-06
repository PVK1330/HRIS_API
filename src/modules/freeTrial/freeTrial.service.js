'use strict';

const repo = require('./freeTrial.repository');

function rowToApi(row) {
  if (!row) {
    return {
      trialEnabled: false,
      trialDays: 14,
      mandatoryPaymentMethod: false,
      maxTenantsPerIdentity: 1,
      updatedAt: null,
    };
  }
  return {
    trialEnabled: !!row.trial_enabled,
    trialDays: row.trial_days,
    mandatoryPaymentMethod: !!row.mandatory_payment_method,
    maxTenantsPerIdentity: row.max_tenants_per_identity,
    updatedAt: row.updated_at,
  };
}

async function getFreeTrial() {
  const row = await repo.findSingleton();
  return rowToApi(row);
}

async function updateFreeTrial(input = {}) {
  const row = await repo.upsertSingleton({
    trialEnabled:           input.trialEnabled,
    trialDays:              input.trialDays,
    mandatoryPaymentMethod: input.mandatoryPaymentMethod,
    maxTenantsPerIdentity:  input.maxTenantsPerIdentity,
  });
  return rowToApi(row);
}

module.exports = {
  getFreeTrial,
  updateFreeTrial,
};
