'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { superAdminPool } = require('../../config/db');
const { sendMail } = require('../../utils/mail');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

const { renderEmail } = require('../../utils/emailTemplate');

/**
 * Request Password Reset OTP
 */
async function requestPasswordReset(email) {
  // 1. Check if user exists in SuperAdmin or Tenants
  // For simplicity, we search in public.tenants (admin_email) first
  const result = await superAdminPool.query(
    'SELECT id, name FROM public.tenants WHERE admin_email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    // We don't reveal if email exists or not for security
    return { success: true, message: 'If the email exists, an OTP has been sent.' };
  }

  const tenant = result.rows[0];
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  // 2. Store OTP in DB
  await superAdminPool.query(
    `UPDATE public.tenants 
     SET otp_code = $1, otp_expires_at = $2 
     WHERE id = $3`,
    [otp, expiresAt, tenant.id]
  );

  // 3. Render and Send Email
  const html = await renderEmail('forgot-password', {
    otp,
    name: tenant.name
  });

  await sendMail({
    to: email,
    subject: 'HRIS - Password Reset Code',
    text: `Your password reset code is: ${otp}. It will expire in 10 minutes.`,
    html
  });

  return { success: true };
}

/**
 * Verify OTP
 */
async function verifyOTP(email, otp) {
  const result = await superAdminPool.query(
    `SELECT id, otp_code, otp_expires_at 
     FROM public.tenants 
     WHERE admin_email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const user = result.rows[0];

  if (!user.otp_code || user.otp_code !== otp) {
    throw ApiError.badRequest('Invalid OTP code');
  }

  if (new Date() > new Date(user.otp_expires_at)) {
    throw ApiError.badRequest('OTP code has expired');
  }

  return { success: true };
}

/**
 * Reset Password
 */
async function resetPassword(email, otp, newPassword) {
  const normalizedEmail = String(email).trim().toLowerCase();
  await verifyOTP(normalizedEmail, otp);

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);

  // 1. Get tenant info to find their DB
  const result = await superAdminPool.query(
    'SELECT id, db_name FROM public.tenants WHERE admin_email = $1',
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const tenant = result.rows[0];

  // 2. Update Central DB
  await superAdminPool.query(
    `UPDATE public.tenants 
     SET password_hash = $1, otp_code = NULL, otp_expires_at = NULL 
     WHERE id = $2`,
    [passwordHash, tenant.id]
  );

  // 3. Update Tenant DB
  const { getTenantPool } = require('../../config/db');
  const tenantPool = getTenantPool(tenant.db_name);

  await tenantPool.query(
    `UPDATE admin_users 
     SET password_hash = $1 
     WHERE email = $2`,
    [passwordHash, normalizedEmail]
  );

  return { success: true };
}

/**
 * Verify 2FA Code during Login
 */
async function verify2FA(userId, code) {
  const result = await superAdminPool.query(
    'SELECT two_factor_secret FROM public.tenants WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const { two_factor_secret } = result.rows[0];

  const verified = speakeasy.totp.verify({
    secret: two_factor_secret,
    encoding: 'base32',
    token: code
  });

  if (!verified) {
    throw ApiError.badRequest('Invalid 2FA code');
  }

  return { success: true };
}

/**
 * Login for Tenant Admins
 */
async function login(email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // 1. Find tenant in central DB to get their specific DB name
  const centralResult = await superAdminPool.query(
    'SELECT id, name, db_name, status, plan_id FROM public.tenants WHERE admin_email = $1',
    [normalizedEmail]
  );

  if (centralResult.rows.length === 0) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const tenant = centralResult.rows[0];
  if (tenant.status !== 'active') {
    throw ApiError.unauthorized('Account is suspended or inactive');
  }

  // 2. Connect to Tenant DB and verify user
  const { getTenantPool } = require('../../config/db');
  const tenantPool = getTenantPool(tenant.db_name);

  const userResult = await tenantPool.query(
    'SELECT id, email, password_hash, name, status FROM admin_users WHERE email = $1',
    [normalizedEmail]
  );

  if (userResult.rows.length === 0) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const user = userResult.rows[0];
  if (user.status !== 'active') {
    throw ApiError.unauthorized('User account is inactive');
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 3. Fetch Plan Details and Features
  let planDetails = null;
  let planFeatures = [];

  if (tenant.plan_id) {
    const plansRepo = require('../superadmin/plans.repository');
    planDetails = await plansRepo.findById(tenant.plan_id);
    if (planDetails) {
      planFeatures = await plansRepo.getFeatures(tenant.plan_id);
    }
  }

  // 3.1 Fetch tenant-specific enabled features from tenant_access_controls
  const accessResult = await superAdminPool.query(
    `
      SELECT
        pf.id,
        pf.feature_name,
        pf.feature_code,
        pf.feature_description,
        tac.is_enabled
      FROM public.tenant_access_controls tac
      JOIN public.platform_features pf ON pf.id = tac.feature_id
      WHERE tac.tenant_id = $1
        AND tac.is_enabled = true
        AND pf.feature_is_active = true
      ORDER BY pf.feature_sort_order ASC, pf.feature_name ASC
    `,
    [tenant.id]
  );

  const tenantFeatures = accessResult.rows.map((row) => ({
    id: row.id,
    feature_name: row.feature_name,
    feature_code: row.feature_code,
    feature_description: row.feature_description,
    is_enabled: row.is_enabled,
  }));

  // 4. Generate JWT
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: 'admin',
      tenant_id: tenant.id,
      db_name: tenant.db_name
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'admin',
      tenantId: tenant.id,
      tenantName: tenant.name
    },
    plan_details: planDetails ? [planDetails] : [],
    plan_features: planFeatures,
    tenant_features: tenantFeatures
  };
}

async function generateImpersonationToken(tenantId) {
  const parsedTenantId = Number(tenantId);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0) {
    throw ApiError.badRequest('Invalid tenant id');
  }

  const tenantResult = await superAdminPool.query(
    'SELECT id, name, db_name, status, plan_id, admin_email FROM public.tenants WHERE id = $1 LIMIT 1',
    [parsedTenantId]
  );

  if (tenantResult.rows.length === 0) {
    throw ApiError.notFound('Tenant not found');
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    throw ApiError.badRequest('Tenant is not active');
  }

  const { getTenantPool } = require('../../config/db');
  const tenantPool = getTenantPool(tenant.db_name);

  let userResult = await tenantPool.query(
    'SELECT id, email, name, status FROM admin_users WHERE email = $1 LIMIT 1',
    [tenant.admin_email]
  );
  if (userResult.rows.length === 0) {
    userResult = await tenantPool.query(
      "SELECT id, email, name, status FROM admin_users WHERE status = 'active' ORDER BY id ASC LIMIT 1"
    );
  }
  if (userResult.rows.length === 0) {
    throw ApiError.notFound('No tenant admin user found');
  }

  const user = userResult.rows[0];
  if (user.status !== 'active') {
    throw ApiError.badRequest('Tenant admin user is inactive');
  }

  let planDetails = null;
  let planFeatures = [];
  if (tenant.plan_id) {
    const plansRepo = require('../superadmin/plans.repository');
    planDetails = await plansRepo.findById(tenant.plan_id);
    if (planDetails) {
      planFeatures = await plansRepo.getFeatures(tenant.plan_id);
    }
  }

  const accessResult = await superAdminPool.query(
    `
      SELECT
        pf.id,
        pf.feature_name,
        pf.feature_code,
        pf.feature_description,
        tac.is_enabled
      FROM public.tenant_access_controls tac
      JOIN public.platform_features pf ON pf.id = tac.feature_id
      WHERE tac.tenant_id = $1
        AND tac.is_enabled = true
        AND pf.feature_is_active = true
      ORDER BY pf.feature_sort_order ASC, pf.feature_name ASC
    `,
    [tenant.id]
  );

  const tenantFeatures = accessResult.rows.map((row) => ({
    id: row.id,
    feature_name: row.feature_name,
    feature_code: row.feature_code,
    feature_description: row.feature_description,
    is_enabled: row.is_enabled,
  }));

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: 'admin',
      tenant_id: tenant.id,
      db_name: tenant.db_name
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'admin',
      tenantId: tenant.id,
      tenantName: tenant.name
    },
    plan_details: planDetails ? [planDetails] : [],
    plan_features: planFeatures,
    tenant_features: tenantFeatures
  };
}

async function getAccessProfile(currentUser) {
  if (!currentUser || currentUser.role !== 'admin') {
    throw ApiError.forbidden('Access profile is only available for tenant admins');
  }
  if (!currentUser.tenant_id) {
    throw ApiError.badRequest('tenant_id is missing in auth token');
  }

  const tenantResult = await superAdminPool.query(
    'SELECT id, name, db_name, status, plan_id FROM public.tenants WHERE id = $1 LIMIT 1',
    [currentUser.tenant_id]
  );
  if (tenantResult.rows.length === 0) {
    throw ApiError.notFound('Tenant not found');
  }
  const tenant = tenantResult.rows[0];

  let planDetails = null;
  if (tenant.plan_id) {
    const plansRepo = require('../superadmin/plans.repository');
    planDetails = await plansRepo.findById(tenant.plan_id);
  }

  const accessResult = await superAdminPool.query(
    `
      SELECT
        pf.id,
        pf.feature_name,
        pf.feature_code,
        pf.feature_description,
        tac.is_enabled
      FROM public.tenant_access_controls tac
      JOIN public.platform_features pf ON pf.id = tac.feature_id
      WHERE tac.tenant_id = $1
        AND tac.is_enabled = true
        AND pf.feature_is_active = true
      ORDER BY pf.feature_sort_order ASC, pf.feature_name ASC
    `,
    [tenant.id]
  );

  const tenantFeatures = accessResult.rows.map((row) => ({
    id: row.id,
    feature_name: row.feature_name,
    feature_code: row.feature_code,
    feature_description: row.feature_description,
    is_enabled: row.is_enabled,
  }));

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      db_name: tenant.db_name,
      status: tenant.status,
      plan_id: tenant.plan_id,
    },
    plan_details: planDetails ? [planDetails] : [],
    tenant_features: tenantFeatures,
    refreshed_at: new Date().toISOString(),
  };
}

module.exports = {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  verify2FA,
  login,
  generateImpersonationToken,
  getAccessProfile
};
