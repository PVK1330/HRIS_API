'use strict';

const db = require('../../config/db');

const BASE_SELECT = `
  SELECT
    id,
    trial_enabled,
    trial_days,
    mandatory_payment_method,
    max_tenants_per_identity,
    created_at,
    updated_at
  FROM public.free_trial_settings
  ORDER BY created_at ASC
  LIMIT 1
`;

async function findSingleton() {
  const { rows } = await db.query(BASE_SELECT);
  return rows[0] || null;
}

async function upsertSingleton({
  trialEnabled,
  trialDays,
  mandatoryPaymentMethod,
  maxTenantsPerIdentity,
}) {
  const existing = await findSingleton();

  if (!existing) {
    const insertSql = `
      INSERT INTO public.free_trial_settings
        (trial_enabled, trial_days, mandatory_payment_method, max_tenants_per_identity)
      VALUES ($1, $2, $3, $4)
      RETURNING
        id, trial_enabled, trial_days, mandatory_payment_method,
        max_tenants_per_identity, created_at, updated_at
    `;
    const { rows } = await db.query(insertSql, [
      trialEnabled === undefined ? false : !!trialEnabled,
      trialDays    === undefined ? 14    : trialDays,
      mandatoryPaymentMethod === undefined ? false : !!mandatoryPaymentMethod,
      maxTenantsPerIdentity  === undefined ? 1     : maxTenantsPerIdentity,
    ]);
    return rows[0];
  }

  const updateSql = `
    UPDATE public.free_trial_settings
       SET trial_enabled            = COALESCE($1, trial_enabled),
           trial_days               = COALESCE($2, trial_days),
           mandatory_payment_method = COALESCE($3, mandatory_payment_method),
           max_tenants_per_identity = COALESCE($4, max_tenants_per_identity),
           updated_at               = NOW()
     WHERE id = $5
    RETURNING
      id, trial_enabled, trial_days, mandatory_payment_method,
      max_tenants_per_identity, created_at, updated_at
  `;
  const params = [
    trialEnabled === undefined ? null : trialEnabled,
    trialDays    === undefined ? null : trialDays,
    mandatoryPaymentMethod === undefined ? null : mandatoryPaymentMethod,
    maxTenantsPerIdentity  === undefined ? null : maxTenantsPerIdentity,
    existing.id,
  ];
  const { rows } = await db.query(updateSql, params);
  return rows[0];
}

module.exports = {
  findSingleton,
  upsertSingleton,
};
