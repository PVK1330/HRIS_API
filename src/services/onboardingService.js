const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { superadminPool } = require('../config/db');
const { createTenantSchema } = require('../modules/tenant/tenant.service');
const { isValidTimezone } = require('../utils/timezone');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Superadmin onboards a new tenant (Admin company)
 */
async function superadminOnboardTenant(tenantData, superadminId) {
  const client = await superadminPool.connect();
  
  try {
    await client.query('BEGIN');

    // Validate required fields
    const required = ['companyName', 'adminEmail', 'planId'];
    for (const field of required) {
      if (!tenantData[field]) {
        throw ApiError.badRequest(`Missing required field: ${field}`);
      }
    }

    // Validate timezone
    if (tenantData.timezone && !isValidTimezone(tenantData.timezone)) {
      throw ApiError.badRequest('Invalid timezone');
    }

    // Generate secure schema name
    const tenantSuffix = crypto.randomBytes(6).toString('hex');
    const schemaName = `tenant_${Date.now()}_${tenantSuffix}`;

    // Generate secure temporary password
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, env.BCRYPT_SALT_ROUNDS);

    // Insert tenant record
    const tenantResult = await client.query(
      `INSERT INTO public.tenants (
        name, schema_name, admin_email, admin_name, admin_phone,
        company_name, company_legal_name, industry, company_size, business_type,
        tax_id, registration_number, website,
        address_line1, address_line2, city, state, country, postal_code,
        plan_id, subscription_status, trial_ends_at,
        timezone, date_format, time_format,
        onboarding_status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING id, schema_name, admin_email`,
      [
        tenantData.companyName,
        schemaName,
        tenantData.adminEmail,
        tenantData.adminName || null,
        tenantData.adminPhone || null,
        tenantData.companyName,
        tenantData.companyLegalName || null,
        tenantData.industry || null,
        tenantData.companySize || null,
        tenantData.businessType || null,
        tenantData.taxId || null,
        tenantData.registrationNumber || null,
        tenantData.website || null,
        tenantData.addressLine1 || null,
        tenantData.addressLine2 || null,
        tenantData.city || null,
        tenantData.state || null,
        tenantData.country || 'United Arab Emirates',
        tenantData.postalCode || null,
        tenantData.planId,
        'trial',
        tenantData.trialDays ? new Date(Date.now() + tenantData.trialDays * 24 * 60 * 60 * 1000) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        tenantData.timezone || 'UTC',
        tenantData.dateFormat || 'DD/MM/YYYY',
        tenantData.timeFormat || '24h',
        'in_progress',
        superadminId
      ]
    );

    const tenant = tenantResult.rows[0];

    // Create tenant schema
    await createTenantSchema({
      id: tenant.id,
      name: tenantData.companyName,
      adminEmail: tenantData.adminEmail,
      adminName: tenantData.adminName || 'Admin',
      password: tempPassword,
      createdBy: superadminId
    });

    // Create subscription record
    const subscriptionResult = await client.query(
      `INSERT INTO public.tenant_subscriptions (
        tenant_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, trial_end
      ) VALUES ($1, $2, 'trial', 'monthly', NOW(), NOW() + INTERVAL '14 days', NOW() + INTERVAL '14 days')
      RETURNING id`,
      [tenant.id, tenantData.planId]
    );

    await client.query('COMMIT');

    return {
      tenant: {
        id: tenant.id,
        schemaName: tenant.schema_name,
        adminEmail: tenant.admin_email,
        tempPassword
      },
      subscriptionId: subscriptionResult.rows[0].id
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Admin self-onboarding (creates tenant account)
 */
async function adminSelfOnboard(onboardingData) {
  const client = await superadminPool.connect();
  
  try {
    await client.query('BEGIN');

    // Validate required fields
    const required = ['companyName', 'adminName', 'adminEmail', 'password', 'planId'];
    for (const field of required) {
      if (!onboardingData[field]) {
        throw ApiError.badRequest(`Missing required field: ${field}`);
      }
    }

    // Validate email uniqueness
    const existingTenant = await client.query(
      'SELECT id FROM public.tenants WHERE admin_email = $1',
      [onboardingData.adminEmail]
    );
    if (existingTenant.rows.length > 0) {
      throw ApiError.conflict('Email already registered');
    }

    // Validate timezone
    if (onboardingData.timezone && !isValidTimezone(onboardingData.timezone)) {
      throw ApiError.badRequest('Invalid timezone');
    }

    // Generate secure schema name
    const tenantSuffix = crypto.randomBytes(6).toString('hex');
    const schemaName = `tenant_${Date.now()}_${tenantSuffix}`;

    // Insert tenant record
    const tenantResult = await client.query(
      `INSERT INTO public.tenants (
        name, schema_name, admin_email, admin_name, admin_phone,
        company_name, company_legal_name, industry, company_size, business_type,
        tax_id, registration_number, website,
        address_line1, address_line2, city, state, country, postal_code,
        plan_id, subscription_status, trial_ends_at,
        timezone, date_format, time_format,
        onboarding_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, 'pending')
      RETURNING id, schema_name, admin_email`,
      [
        onboardingData.companyName,
        schemaName,
        onboardingData.adminEmail,
        onboardingData.adminName,
        onboardingData.adminPhone || null,
        onboardingData.companyName,
        onboardingData.companyLegalName || null,
        onboardingData.industry || null,
        onboardingData.companySize || null,
        onboardingData.businessType || null,
        onboardingData.taxId || null,
        onboardingData.registrationNumber || null,
        onboardingData.website || null,
        onboardingData.addressLine1 || null,
        onboardingData.addressLine2 || null,
        onboardingData.city || null,
        onboardingData.state || null,
        onboardingData.country || 'United Arab Emirates',
        onboardingData.postalCode || null,
        onboardingData.planId,
        'trial',
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        onboardingData.timezone || 'UTC',
        onboardingData.dateFormat || 'DD/MM/YYYY',
        onboardingData.timeFormat || '24h'
      ]
    );

    const tenant = tenantResult.rows[0];

    // Create tenant schema
    await createTenantSchema({
      id: tenant.id,
      name: onboardingData.companyName,
      adminEmail: onboardingData.adminEmail,
      adminName: onboardingData.adminName,
      password: onboardingData.password,
      createdBy: null
    });

    // Create subscription record
    const subscriptionResult = await client.query(
      `INSERT INTO public.tenant_subscriptions (
        tenant_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, trial_end
      ) VALUES ($1, $2, 'trial', 'monthly', NOW(), NOW() + INTERVAL '14 days', NOW() + INTERVAL '14 days')
      RETURNING id`,
      [tenant.id, onboardingData.planId]
    );

    await client.query('COMMIT');

    return {
      tenant: {
        id: tenant.id,
        schemaName: tenant.schema_name,
        adminEmail: tenant.admin_email
      },
      subscriptionId: subscriptionResult.rows[0].id
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Complete onboarding (called after admin logs in and sets up)
 */
async function completeOnboarding(tenantId) {
  const result = await superadminPool.query(
    `UPDATE public.tenants
     SET onboarding_status = 'completed', updated_at = NOW()
     WHERE id = $1
     RETURNING id, onboarding_status`,
    [tenantId]
  );
  return result.rows[0];
}

/**
 * Generate secure temporary password
 */
function generateTempPassword(length = 16) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map(b => all[b % all.length])
    .join('');
}

module.exports = {
  superadminOnboardTenant,
  adminSelfOnboard,
  completeOnboarding,
};
