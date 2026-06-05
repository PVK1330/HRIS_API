'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { comparePassword, hashPassword } = require('../../utils/password');
const logger = require('../../utils/logger');
const { slugifyTenantName } = require('../../utils/tenantSlug');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { superAdminPool } = require('../../config/db');
const { sendMail } = require('../../utils/mail');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

const { renderEmail } = require('../../utils/emailTemplate');
const {
  expandPermissionKeys,
  toAllowedModuleKeys,
  toAllowedModulesForJwt,
} = require('../../constants/permissions');

async function gatherTenantFeatures(tenantId) {
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
    [tenantId],
  );

  return accessResult.rows.map((row) => ({
    id: row.id,
    feature_name: row.feature_name,
    feature_code: row.feature_code,
    feature_description: row.feature_description,
    is_enabled: row.is_enabled,
  }));
}

async function fetchPlanBundles(planId) {
  let planDetails = null;
  let planFeatures = [];
  if (planId) {
    const plansRepo = require('../superadmin/plans.repository');
    planDetails = await plansRepo.findById(planId);
    if (planDetails) {
      planFeatures = await plansRepo.getFeatures(planId);
    }
  }
  return { planDetails: planDetails ? [planDetails] : [], planFeatures };
}

/**
 * Tenant admin sidebar modules follow the "Organization Admin" RBAC role
 * (Settings → Roles & permissions), not every permission in the database.
 */
async function adminModulesForJwt(tenantPool) {
  const rbacRepo = require('../rbac/rbac.repository');
  try {
    const { rows: roleRows } = await tenantPool.query(
      `SELECT id FROM rbac_roles
       WHERE is_system = TRUE AND name = 'Organization Admin'
       LIMIT 1`,
    );
    const orgAdminRoleId = roleRows[0]?.id;
    if (orgAdminRoleId) {
      const keys = await rbacRepo.permissionKeysForRole(tenantPool, orgAdminRoleId);
      if (keys.length) {
        const expanded = expandPermissionKeys(keys);
        const modules = toAllowedModuleKeys(expanded);
        if (!modules.includes('dashboard')) modules.unshift('dashboard');
        if (!modules.includes('system-settings')) modules.push('system-settings');
        return modules;
      }
    }
    const { rows } = await tenantPool.query(
      `SELECT key FROM rbac_permissions ORDER BY sort_order ASC, id ASC`,
    );
    const modules = rows.length ? rows.map((r) => r.key) : ['dashboard'];
    if (!modules.includes('system-settings')) modules.push('system-settings');
    return modules;
  } catch (_e) {
    return ['dashboard', 'system-settings'];
  }
}

/**
 * Helper to find a user (admin or employee) by email, optionally within a tenant context.
 * If no tenant context is provided, it scans all active tenant databases.
 */
async function findUserByEmail(email, context = {}) {
  const normalizedEmail = normalizeLoginId(email);

  // 1. Resolve tenant context if passed
  let tenant = null;
  if (context.tenantSlug || context.tenantId) {
    tenant = await resolveTenantForLogin({
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
    });
  }

  const { getTenantPool } = require('../../config/db');

  if (tenant) {
    // Search within this specific tenant database
    const tenantPool = getTenantPool(tenant.db_name);

    // Check if they are a tenant admin
    const adminResult = await tenantPool.query(
      `SELECT id, email, name, status FROM admin_users WHERE ${sqlEmailMatchesLogin('email')} LIMIT 1`,
      [normalizedEmail]
    );
    if (adminResult.rows.length > 0) {
      return { tenant, userType: 'admin', user: adminResult.rows[0] };
    }

    // Check if they are an employee
    const employeeResult = await tenantPool.query(
      `SELECT id, work_email AS email, full_name AS name, employment_status FROM employees WHERE deleted_at IS NULL AND ${sqlEmailMatchesLogin('work_email')} LIMIT 1`,
      [normalizedEmail]
    );
    if (employeeResult.rows.length > 0) {
      return { tenant, userType: 'employee', user: employeeResult.rows[0] };
    }

    return null;
  }

  // 2. If no tenant context is passed, search centrally first (matching primary admin email)
  const centralResult = await superAdminPool.query(
    `SELECT id, name, db_name, status, admin_email FROM public.tenants WHERE ${sqlEmailMatchesLogin('admin_email')} LIMIT 1`,
    [normalizedEmail]
  );
  if (centralResult.rows.length > 0) {
    const centralTenant = centralResult.rows[0];
    const tenantPool = getTenantPool(centralTenant.db_name);

    const adminResult = await tenantPool.query(
      `SELECT id, email, name, status FROM admin_users WHERE ${sqlEmailMatchesLogin('email')} LIMIT 1`,
      [normalizedEmail]
    );
    if (adminResult.rows.length > 0) {
      return { tenant: centralTenant, userType: 'admin', user: adminResult.rows[0] };
    }
  }

  // 3. Fallback: scan all active tenants
  const tenantsResult = await superAdminPool.query(
    "SELECT id, name, db_name, status, admin_email FROM public.tenants WHERE status = 'active'"
  );

  for (const activeTenant of tenantsResult.rows) {
    try {
      const tenantPool = getTenantPool(activeTenant.db_name);

      // Check admin users
      const adminResult = await tenantPool.query(
        `SELECT id, email, name, status FROM admin_users WHERE ${sqlEmailMatchesLogin('email')} LIMIT 1`,
        [normalizedEmail]
      );
      if (adminResult.rows.length > 0) {
        return { tenant: activeTenant, userType: 'admin', user: adminResult.rows[0] };
      }

      // Check employees
      const employeeResult = await tenantPool.query(
        `SELECT id, work_email AS email, full_name AS name, employment_status FROM employees WHERE deleted_at IS NULL AND ${sqlEmailMatchesLogin('work_email')} LIMIT 1`,
        [normalizedEmail]
      );
      if (employeeResult.rows.length > 0) {
        return { tenant: activeTenant, userType: 'employee', user: employeeResult.rows[0] };
      }
    } catch (err) {
      logger.error(`Error scanning tenant db ${activeTenant.db_name} for forgot password:`, err);
    }
  }

  return null;
}

/**
 * Request Password Reset OTP
 */
async function requestPasswordReset(email, context = {}) {
  const normalizedEmail = normalizeLoginId(email);
  const resolved = await findUserByEmail(normalizedEmail, context);

  if (!resolved) {
    // Return success to avoid email enumeration security vulnerability
    return { success: true, message: 'If the email exists, an OTP has been sent.' };
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  // 1. Clean up any existing resets for this email centrally
  await superAdminPool.query(
    'DELETE FROM public.password_resets WHERE LOWER(email) = LOWER($1)',
    [normalizedEmail]
  );

  // 2. Store OTP reset centrally in public.password_resets
  await superAdminPool.query(
    `INSERT INTO public.password_resets (email, tenant_id, user_type, otp_code, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [normalizedEmail, resolved.tenant.id, resolved.userType, otp, expiresAt]
  );

  // 3. Render and Send Email
  const html = await renderEmail('forgot-password', {
    otp,
    name: resolved.user.name || resolved.tenant.name,
  });

  await sendMail({
    to: normalizedEmail,
    subject: 'HRIS - Password Reset Code',
    text: `Your password reset code is: ${otp}. It will expire in 10 minutes.`,
    html,
  });

  return { success: true };
}

/**
 * Verify OTP
 */
async function verifyOTP(email, otp) {
  const normalizedEmail = normalizeLoginId(email);

  const result = await superAdminPool.query(
    `SELECT id, expires_at 
     FROM public.password_resets 
     WHERE LOWER(email) = LOWER($1) AND otp_code = $2`,
    [normalizedEmail, otp]
  );

  if (result.rows.length === 0) {
    throw ApiError.badRequest('Invalid OTP code');
  }

  const reset = result.rows[0];

  if (new Date() > new Date(reset.expires_at)) {
    throw ApiError.badRequest('OTP code has expired');
  }

  return { success: true };
}

/**
 * Reset Password
 */
async function resetPassword(email, otp, newPassword) {
  const normalizedEmail = normalizeLoginId(email);

  // 1. Verify OTP first (throws on error/expiry)
  await verifyOTP(normalizedEmail, otp);

  // 2. Fetch reset information
  const resetResult = await superAdminPool.query(
    `SELECT tenant_id, user_type 
     FROM public.password_resets 
     WHERE LOWER(email) = LOWER($1) AND otp_code = $2`,
    [normalizedEmail, otp]
  );

  if (resetResult.rows.length === 0) {
    throw ApiError.badRequest('Invalid or expired password reset request');
  }

  const { tenant_id, user_type } = resetResult.rows[0];

  // 3. Get tenant info
  const tenantResult = await superAdminPool.query(
    'SELECT id, db_name, admin_email FROM public.tenants WHERE id = $1',
    [tenant_id]
  );
  if (tenantResult.rows.length === 0) {
    throw ApiError.notFound('Tenant not found');
  }
  const tenant = tenantResult.rows[0];

  // 4. Hash new password
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);

  // 5. Update Tenant DB
  const { getTenantPool } = require('../../config/db');
  const tenantPool = getTenantPool(tenant.db_name);

  if (user_type === 'admin') {
    await tenantPool.query(
      `UPDATE admin_users 
       SET password_hash = $1 
       WHERE ${sqlEmailMatchesLogin('email', '$2')}`,
      [passwordHash, normalizedEmail]
    );

    // If they are primary admin, update central DB too
    if (tenant.admin_email && normalizeLoginId(tenant.admin_email) === normalizedEmail) {
      await superAdminPool.query(
        `UPDATE public.tenants 
         SET password_hash = $1 
         WHERE id = $2`,
        [passwordHash, tenant.id]
      );
    }
  } else if (user_type === 'employee') {
    await tenantPool.query(
      `UPDATE employees 
       SET password_hash = $1 
       WHERE deleted_at IS NULL AND ${sqlEmailMatchesLogin('work_email', '$2')}`,
      [passwordHash, normalizedEmail]
    );
  }

  // 6. Delete password reset token so it cannot be reused
  await superAdminPool.query(
    'DELETE FROM public.password_resets WHERE LOWER(email) = LOWER($1)',
    [normalizedEmail]
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
 * Normalize login identifiers. For @gmail.com and @googlemail.com, strip dots in
 * the local part (Gmail treats them as equivalent). Other domains keep dots.
 */
function normalizeLoginId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s.includes('@')) return s;
  const at = s.lastIndexOf('@');
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.replace(/\./g, '')}@${domain}`;
  }
  return s;
}

/**
 * SQL: column matches normalized login $1, with Gmail / Googlemail dot-equivalence.
 */
function sqlEmailMatchesLogin(col, param = '$1') {
  return `(
    LOWER(TRIM(${col})) = ${param}
    OR (
      ${param} LIKE '%@gmail.com'
      AND RIGHT(LOWER(TRIM(${col})), 10) = '@gmail.com'
      AND regexp_replace(split_part(LOWER(TRIM(${col})), '@', 1), '\\.', '', 'g') || '@gmail.com' = ${param}
    )
    OR (
      ${param} LIKE '%@googlemail.com'
      AND RIGHT(LOWER(TRIM(${col})), 14) = '@googlemail.com'
      AND regexp_replace(split_part(LOWER(TRIM(${col})), '@', 1), '\\.', '', 'g') || '@googlemail.com' = ${param}
    )
  )`;
}

/**
 * Resolve tenant for workspace login (numeric id, subdomain slug, or schema_name).
 */
async function resolveTenantForLogin({ tenantId, tenantSlug }) {
  const idParsed =
    tenantId != null && `${tenantId}`.trim() !== ''
      ? parseInt(String(tenantId), 10)
      : NaN;

  if (Number.isInteger(idParsed) && idParsed > 0) {
    const { rows } = await superAdminPool.query(
      `SELECT id, name, db_name, status, plan_id, admin_email
       FROM public.tenants WHERE id = $1 LIMIT 1`,
      [idParsed],
    );
    if (rows.length) return rows[0];
  }

  const slugRaw = String(tenantSlug || '').trim().toLowerCase();
  if (!slugRaw) return null;

  const { rows: bySchema } = await superAdminPool.query(
    `SELECT id, name, db_name, status, plan_id, admin_email
     FROM public.tenants
     WHERE LOWER(schema_name) = $1 OR id::text = $1
     LIMIT 1`,
    [slugRaw],
  );
  if (bySchema.length) return bySchema[0];

  const slugNorm = slugifyTenantName(slugRaw);
  const { rows: all } = await superAdminPool.query(
    `SELECT id, name, db_name, status, plan_id, admin_email FROM public.tenants`,
  );
  return all.find((t) => slugifyTenantName(t.name) === slugNorm) || null;
}

async function findEmployeeForLogin(tenantPool, loginId) {
  const { rows } = await tenantPool.query(
    `
      SELECT id, full_name, work_email, username, password_hash, portal_enabled,
             rbac_role_id, employment_status, department
      FROM employees
      WHERE deleted_at IS NULL
        AND (
          ${sqlEmailMatchesLogin('work_email')}
          OR ${sqlEmailMatchesLogin('username')}
        )
      LIMIT 1
    `,
    [loginId],
  );
  return rows[0] || null;
}

async function provisionTenantAdminUser(tenantPool, tenant, { email, passwordHash, name }) {
  const normalized = normalizeLoginId(email);
  if (!normalized || !passwordHash) return null;

  const { rows } = await tenantPool.query(
    `
      INSERT INTO admin_users (tenant_id, email, password_hash, name, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            name = COALESCE(NULLIF(EXCLUDED.name, ''), admin_users.name),
            status = 'active'
      RETURNING id, email, password_hash, name, status
    `,
    [tenant.id, normalized, passwordHash, name || 'Organization Admin'],
  );
  logger.info(`[auth] provisioned admin_users for tenant ${tenant.id} (${normalized})`);
  return rows[0] || null;
}

async function findTenantAdminForLogin(tenantPool, loginId, tenantAdminEmail) {
  const { rows } = await tenantPool.query(
    `
      SELECT id, email, password_hash, name, status
      FROM admin_users
      WHERE ${sqlEmailMatchesLogin('email')}
      LIMIT 1
    `,
    [loginId],
  );
  if (rows.length > 0) return rows[0];

  const registryEmail = normalizeLoginId(tenantAdminEmail);
  if (!registryEmail || registryEmail !== loginId) return null;

  const fallback = await tenantPool.query(
    `
      SELECT id, email, password_hash, name, status
      FROM admin_users
      WHERE status = 'active'
      ORDER BY id ASC
      LIMIT 1
    `,
  );
  return fallback.rows[0] || null;
}

async function buildEmployeeLoginResult(emp, tenant, tenantPool, tenantFeatures, planDetails, planFeatures, options = {}) {
  if (!options.mfaVerified) {
    const { rows: mfaRows } = await tenantPool.query(
      'SELECT mfa_enabled FROM employees WHERE id = $1',
      [emp.id],
    );
    if (mfaRows[0]?.mfa_enabled) {
      return issueMfaChallenge({
        userType: 'employee',
        tenant,
        userId: emp.id,
        email: emp.work_email,
      });
    }
  }

  const rbacRepo = require('../rbac/rbac.repository');
  const rbacRoleId = emp.rbac_role_id || null;

  let allowedModules = ['dashboard'];
  let permissions = [];
  if (rbacRoleId) {
    const keys = await rbacRepo.permissionKeysForRole(tenantPool, rbacRoleId);
    const expanded = expandPermissionKeys(keys);
    allowedModules = toAllowedModulesForJwt(expanded);
    permissions = Array.from(expanded);
  }

  const token = jwt.sign(
    {
      id: emp.id,
      email: emp.work_email,
      name: emp.full_name,
      role: 'employee',
      tenant_id: tenant.id,
      db_name: tenant.db_name,
      rbacRoleId: rbacRoleId || null,
      employeeId: emp.id,
      department: emp.department || null,
      userType: 'employee',
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn },
  );

  return {
    token,
    user: {
      id: emp.id,
      name: emp.full_name,
      email: emp.work_email,
      role: 'employee',
      tenantId: tenant.id,
      tenantName: tenant.name,
      rbacRoleId: rbacRoleId || null,
      employeeId: emp.id,
      department: emp.department || null,
      permissions,
    },
    plan_details: planDetails,
    plan_features: planFeatures,
    tenant_features: tenantFeatures,
    allowedModules,
    billing: await safeBillingState(tenant.id),
  };
}

async function buildAdminLoginResult(adminUser, tenant, tenantPool, tenantFeatures, planDetails, planFeatures, options = {}) {
  const allowedModules = await adminModulesForJwt(tenantPool);
  const permissions = ['*']; // Admins have all permissions by default

  // Try to find a matching employee record by email
  const { rows: empRows } = await tenantPool.query(
    `SELECT id FROM employees WHERE deleted_at IS NULL AND LOWER(work_email) = LOWER($1) LIMIT 1`,
    [adminUser.email]
  );
  let employeeId = empRows[0]?.id || null;

  if (!employeeId) {
    try {
      // Get the default Organization Admin role ID
      const { rows: roleRows } = await tenantPool.query(
        `SELECT id FROM rbac_roles WHERE name = 'Organization Admin' AND is_system = true LIMIT 1`
      );
      const roleId = roleRows[0]?.id || null;

      // Provision a shadow employee record for the admin
      const nextEmpId = await require('../employees/employees.repository').getNextEmpId(tenantPool);
      const { rows: newEmp } = await tenantPool.query(
        `INSERT INTO employees (
           emp_id, full_name, work_email, username, portal_enabled, rbac_role_id,
           employment_status, job_title, department, employment_type, join_date
         ) VALUES ($1, $2, $3, $4, true, $5, 'Active', $6, $7, $8, CURRENT_DATE)
         RETURNING id`,
        [
          nextEmpId,
          adminUser.name || 'Organization Admin',
          adminUser.email,
          adminUser.email.split('@')[0],
          roleId,
          'Organization Admin',
          'General',
          'Full-time',
        ],
      );
      employeeId = newEmp[0]?.id || null;
      logger.info(`[auth] auto-provisioned employee record id ${employeeId} for admin user ${adminUser.email}`);
    } catch (err) {
      logger.error(`[auth] failed to auto-provision employee record for admin user:`, err);
    }
  }

  if (!options.mfaVerified) {
    const { rows: mfaRows } = await tenantPool.query(
      'SELECT mfa_enabled FROM admin_users WHERE id = $1',
      [adminUser.id],
    );
    if (mfaRows[0]?.mfa_enabled) {
      return issueMfaChallenge({
        userType: 'admin',
        tenant,
        userId: adminUser.id,
        email: adminUser.email,
      });
    }
  }

  const token = jwt.sign(
    {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'admin',
      tenant_id: tenant.id,
      db_name: tenant.db_name,
      userType: 'admin',
      employeeId: employeeId,
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn },
  );

  return {
    token,
    user: {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: 'admin',
      tenantId: tenant.id,
      tenantName: tenant.name,
      employeeId: employeeId,
      permissions,
    },
    plan_details: planDetails,
    plan_features: planFeatures,
    tenant_features: tenantFeatures,
    allowedModules,
    billing: await safeBillingState(tenant.id),
  };
}

/** Resolve a tenant's billing/trial/payment state, never throwing on the login path. */
async function safeBillingState(tenantId) {
  try {
    const tenantBilling = require('../billing/tenantBilling.service');
    return await tenantBilling.getBillingForTenant(tenantId);
  } catch (err) {
    logger.error('[auth] failed to compute billing state:', err.message);
    return null;
  }
}

/**
 * Builds a short-lived (10 min) signed MFA challenge token. The password has already
 * been verified at this point; the client must exchange this token + a valid TOTP code
 * at POST /auth/verify-2fa to receive the real session token.
 */
function issueMfaChallenge({ userType, tenant, userId, email }) {
  const mfaToken = jwt.sign(
    {
      purpose: 'mfa_login',
      userType,
      tenant_id: tenant.id,
      db_name: tenant.db_name,
      sub: userId,
    },
    env.JWT.secret,
    { expiresIn: '10m' },
  );
  return { mfaRequired: true, mfaToken, email: email || null };
}

/**
 * Completes a login that was paused for MFA: verifies the TOTP code against the user's
 * stored secret and re-issues the full login result.
 */
async function verifyMfaLogin(mfaToken, code) {
  if (!mfaToken) throw ApiError.badRequest('Missing verification session token');

  let payload;
  try {
    payload = jwt.verify(mfaToken, env.JWT.secret);
  } catch (err) {
    throw ApiError.unauthorized('Your verification session has expired. Please sign in again.');
  }
  if (!payload || payload.purpose !== 'mfa_login') {
    throw ApiError.unauthorized('Invalid verification session');
  }

  const { getTenantPool } = require('../../config/db');
  const tenant = await resolveTenantForLogin({ tenantId: payload.tenant_id });
  if (!tenant) throw ApiError.unauthorized('Organization workspace not found');
  if (tenant.status !== 'active') throw ApiError.unauthorized('Account is suspended or inactive');

  const tenantPool = getTenantPool(tenant.db_name);

  const secretTable = payload.userType === 'admin' ? 'admin_users' : 'employees';
  const { rows: secretRows } = await tenantPool.query(
    `SELECT mfa_secret FROM ${secretTable} WHERE id = $1`,
    [payload.sub],
  );
  const secret = secretRows[0]?.mfa_secret;
  if (!secret) {
    throw ApiError.unauthorized('Two-factor authentication is not configured for this account.');
  }

  const ok = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(code || '').trim(),
    window: 1,
  });
  if (!ok) throw ApiError.unauthorized('Invalid verification code');

  const tenantFeatures = await gatherTenantFeatures(tenant.id);
  const { planDetails, planFeatures } = await fetchPlanBundles(tenant.plan_id);

  if (payload.userType === 'employee') {
    const { rows } = await tenantPool.query(
      `SELECT id, full_name, work_email, username, rbac_role_id, employment_status, department
       FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [payload.sub],
    );
    if (!rows[0]) throw ApiError.unauthorized('Account not found');
    if (String(rows[0].employment_status || '').toLowerCase() === 'terminated') {
      throw ApiError.unauthorized('User account is inactive');
    }
    return buildEmployeeLoginResult(
      rows[0], tenant, tenantPool, tenantFeatures, planDetails, planFeatures, { mfaVerified: true },
    );
  }

  const { rows } = await tenantPool.query(
    'SELECT id, email, password_hash, name, status FROM admin_users WHERE id = $1 LIMIT 1',
    [payload.sub],
  );
  if (!rows[0]) throw ApiError.unauthorized('Account not found');
  if (rows[0].status !== 'active') throw ApiError.unauthorized('User account is inactive');
  return buildAdminLoginResult(
    rows[0], tenant, tenantPool, tenantFeatures, planDetails, planFeatures, { mfaVerified: true },
  );
}

/**
 * Tenant workspace login.
 * • With `tenantId` or `tenantSlug`: employee portal (if enabled), then org admin.
 * • Legacy: tenant resolved solely by matching `admin_email` on central `tenants`.
 */
async function login(email, password, options = {}) {
  const loginId = normalizeLoginId(email);
  const tenantIdParsed =
    options?.tenantId != null && `${options.tenantId}`.trim() !== ''
      ? parseInt(String(options.tenantId), 10)
      : NaN;

  const { getTenantPool } = require('../../config/db');
  const { runTenantMigrations } = require('../tenant/tenant.service');

  const tenant = await resolveTenantForLogin({
    tenantId: Number.isInteger(tenantIdParsed) && tenantIdParsed > 0 ? tenantIdParsed : null,
    tenantSlug: options?.tenantSlug,
  });

  if (options?.tenantSlug && String(options.tenantSlug).trim() && !tenant) {
    throw ApiError.unauthorized(
      'Organization workspace not found. Verify the URL or sign in from your company login link.',
    );
  }

  /** Scoped login when tenant is known (org id or subdomain slug) */
  if (tenant) {
    if (tenant.status !== 'active') {
      throw ApiError.unauthorized('Account is suspended or inactive');
    }

    await runTenantMigrations(tenant.db_name).catch(() => {});
    const tenantPool = getTenantPool(tenant.db_name);
    const tenantFeatures = await gatherTenantFeatures(tenant.id);
    const { planDetails, planFeatures } = await fetchPlanBundles(tenant.plan_id);

    const registryEmail = normalizeLoginId(tenant.admin_email);

    // Primary org admin (central registry email) — try before employee portal
    if (loginId.includes('@') && registryEmail && loginId === registryEmail) {
      let adminUser = await findTenantAdminForLogin(
        tenantPool,
        loginId,
        tenant.admin_email,
      );

      if (!adminUser) {
        const emp = await findEmployeeForLogin(tenantPool, loginId);
        if (
          emp &&
          emp.password_hash &&
          (await comparePassword(password, emp.password_hash))
        ) {
          adminUser = await provisionTenantAdminUser(tenantPool, tenant, {
            email: loginId,
            passwordHash: emp.password_hash,
            name: emp.full_name,
          });
        }
      }

      if (adminUser) {
        if (adminUser.status !== 'active') {
          throw ApiError.unauthorized('User account is inactive');
        }
        let okRegistry = await comparePassword(password, adminUser.password_hash);
        if (!okRegistry) {
          const empForSync = await findEmployeeForLogin(tenantPool, loginId);
          if (
            empForSync?.password_hash &&
            (await comparePassword(password, empForSync.password_hash))
          ) {
            await tenantPool.query(
              `UPDATE admin_users SET password_hash = $1 WHERE id = $2`,
              [empForSync.password_hash, adminUser.id],
            );
            adminUser.password_hash = empForSync.password_hash;
            okRegistry = true;
            logger.info(
              `[auth] synced admin_users password from employee record for ${loginId}`,
            );
          }
        }
        if (okRegistry) {
          return buildAdminLoginResult(
            adminUser,
            tenant,
            tenantPool,
            tenantFeatures,
            planDetails,
            planFeatures,
          );
        }
      }
    }

    const emp = await findEmployeeForLogin(tenantPool, loginId);
    const employeePortalActive =
      emp && emp.portal_enabled && emp.password_hash;

    if (employeePortalActive) {
      if (String(emp.employment_status || '').toLowerCase() === 'terminated') {
        throw ApiError.unauthorized('User account is inactive');
      }
      const okEmp = await comparePassword(password, emp.password_hash);
      if (okEmp) {
        return buildEmployeeLoginResult(
          emp,
          tenant,
          tenantPool,
          tenantFeatures,
          planDetails,
          planFeatures,
        );
      }
    }

    if (!loginId.includes('@')) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const adminUser = await findTenantAdminForLogin(
      tenantPool,
      loginId,
      tenant.admin_email,
    );
    if (!adminUser) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    if (adminUser.status !== 'active') {
      throw ApiError.unauthorized('User account is inactive');
    }
    const okAdm = await comparePassword(password, adminUser.password_hash);
    if (!okAdm) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    return buildAdminLoginResult(
      adminUser,
      tenant,
      tenantPool,
      tenantFeatures,
      planDetails,
      planFeatures,
    );
  }

  if (!loginId.includes('@')) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const centralResult = await superAdminPool.query(
    `SELECT id, name, db_name, status, plan_id, admin_email FROM public.tenants WHERE ${sqlEmailMatchesLogin('admin_email')} LIMIT 1`,
    [loginId],
  );

  let resolvedTenant = null;
  let resolvedUser = null;
  let resolvedType = null; // 'admin' or 'employee'

  if (centralResult.rows.length > 0) {
    resolvedTenant = centralResult.rows[0];
    resolvedType = 'admin';
  } else {
    // Fallback scan active tenants to identify user
    const tenantsResult = await superAdminPool.query(
      "SELECT id, name, db_name, status, plan_id, admin_email FROM public.tenants WHERE status = 'active'"
    );

    for (const activeTenant of tenantsResult.rows) {
      try {
        const tenantPool = getTenantPool(activeTenant.db_name);

        // Check if admin user in this tenant
        const adminResult = await tenantPool.query(
          `SELECT id, email, password_hash, name, status FROM admin_users WHERE ${sqlEmailMatchesLogin('email')} LIMIT 1`,
          [loginId]
        );
        if (adminResult.rows.length > 0) {
          const u = adminResult.rows[0];
          if (await comparePassword(password, u.password_hash)) {
            resolvedTenant = activeTenant;
            resolvedUser = u;
            resolvedType = 'admin';
            break;
          }
        }

        // Check if employee in this tenant
        const employeeResult = await tenantPool.query(
          `SELECT id, full_name, work_email, username, password_hash, portal_enabled,
                  rbac_role_id, employment_status, department
           FROM employees
           WHERE deleted_at IS NULL AND ${sqlEmailMatchesLogin('work_email')} LIMIT 1`,
          [loginId]
        );
        if (employeeResult.rows.length > 0) {
          const emp = employeeResult.rows[0];
          if (emp.portal_enabled && emp.password_hash && await comparePassword(password, emp.password_hash)) {
            resolvedTenant = activeTenant;
            resolvedUser = emp;
            resolvedType = 'employee';
            break;
          }
        }
      } catch (err) {
        logger.error(`Error scanning tenant ${activeTenant.db_name} during central login:`, err);
      }
    }
  }

  if (!resolvedTenant) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (resolvedTenant.status !== 'active') {
    throw ApiError.unauthorized('Account is suspended or inactive');
  }

  const tenantPool = getTenantPool(resolvedTenant.db_name);
  await runTenantMigrations(resolvedTenant.db_name).catch(() => {});

  const tenantFeatures = await gatherTenantFeatures(resolvedTenant.id);
  const { planDetails, planFeatures } = await fetchPlanBundles(resolvedTenant.plan_id);

  if (resolvedType === 'admin') {
    let user = resolvedUser;
    if (!user) {
      const userResult = await tenantPool.query(
        `SELECT id, email, password_hash, name, status FROM admin_users WHERE ${sqlEmailMatchesLogin('email')} LIMIT 1`,
        [loginId],
      );

      if (userResult.rows.length === 0) {
        throw ApiError.unauthorized('Invalid email or password');
      }

      user = userResult.rows[0];
      if (user.status !== 'active') {
        throw ApiError.unauthorized('User account is inactive');
      }

      const passwordMatches = await comparePassword(password, user.password_hash);
      if (!passwordMatches) {
        throw ApiError.unauthorized('Invalid email or password');
      }
    }

    return buildAdminLoginResult(
      user,
      resolvedTenant,
      tenantPool,
      tenantFeatures,
      planDetails,
      planFeatures,
    );
  } else if (resolvedType === 'employee') {
    if (String(resolvedUser.employment_status || '').toLowerCase() === 'terminated') {
      throw ApiError.unauthorized('User account is inactive');
    }
    return buildEmployeeLoginResult(
      resolvedUser,
      resolvedTenant,
      tenantPool,
      tenantFeatures,
      planDetails,
      planFeatures,
    );
  }

  throw ApiError.unauthorized('Invalid email or password');
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

  const allowedModules = await adminModulesForJwt(tenantPool);

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: 'admin',
      tenant_id: tenant.id,
      db_name: tenant.db_name,
      userType: 'admin',
    },
    env.JWT.secret,
    { expiresIn: env.JWT.expiresIn },
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'admin',
      tenantId: tenant.id,
      tenantName: tenant.name,
      allowedModules,
    },
    plan_details: planDetails ? [planDetails] : [],
    plan_features: planFeatures,
    tenant_features: tenantFeatures,
    allowedModules,
  };
}

async function getAccessProfile(currentUser) {
  if (!currentUser || !['admin', 'employee'].includes(currentUser.role)) {
    throw ApiError.forbidden('Access profile is only available for tenant users');
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

  const { getTenantPool } = require('../../config/db');
  const rbacRepo = require('../rbac/rbac.repository');

  let allowedModules = ['dashboard'];
  let permissions = [];
  const tenantPool = getTenantPool(tenant.db_name);
  if (currentUser.role === 'admin') {
    allowedModules = await adminModulesForJwt(tenantPool);
    permissions = ['*'];
  } else if (currentUser.rbacRoleId) {
    const keys = await rbacRepo.permissionKeysForRole(tenantPool, currentUser.rbacRoleId);
    const expanded = expandPermissionKeys(keys);
    allowedModules = toAllowedModulesForJwt(expanded);
    permissions = Array.from(expanded);
  }

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
    allowedModules,
    permissions,
    billing: await safeBillingState(tenant.id),
    refreshed_at: new Date().toISOString(),
  };
}

/**
 * Authenticated self-service password change. Verifies the current password and
 * updates the hash in the correct table for the logged-in user's type
 * (superadmin / tenant admin / employee).
 */
async function changePassword(user, { currentPassword, newPassword } = {}) {
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Current and new password are required');
  }
  if (String(newPassword).length < 8) {
    throw ApiError.badRequest('New password must be at least 8 characters');
  }
  if (String(currentPassword) === String(newPassword)) {
    throw ApiError.badRequest('New password must be different from the current password');
  }

  const userType = String(user?.userType || user?.role || '').toLowerCase();
  const id = user?.id;
  if (!id) throw ApiError.unauthorized('Not authenticated');

  const { getTenantPool } = require('../../config/db');
  let currentHash = null;
  let applyUpdate = null;

  if (userType === 'superadmin' || userType === 'billing_admin' || userType === 'support_admin') {
    const { rows } = await superAdminPool.query(
      'SELECT password_hash FROM public.superadmins WHERE id = $1 LIMIT 1',
      [id],
    );
    currentHash = rows[0]?.password_hash || null;
    applyUpdate = (hash) =>
      superAdminPool.query('UPDATE public.superadmins SET password_hash = $1 WHERE id = $2', [hash, id]);
  } else {
    const dbName = user?.db_name;
    if (!dbName) throw ApiError.badRequest('No organization context');
    const tenantPool = getTenantPool(dbName);

    if (userType === 'employee') {
      const { rows } = await tenantPool.query(
        'SELECT password_hash FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [id],
      );
      currentHash = rows[0]?.password_hash || null;
      applyUpdate = (hash) =>
        tenantPool.query('UPDATE employees SET password_hash = $1 WHERE id = $2', [hash, id]);
    } else {
      // Tenant admin (admin / hr_admin / billing_admin / support_admin within a tenant).
      const { rows } = await tenantPool.query(
        'SELECT password_hash, email FROM admin_users WHERE id = $1 LIMIT 1',
        [id],
      );
      currentHash = rows[0]?.password_hash || null;
      const adminEmail = rows[0]?.email || null;
      applyUpdate = async (hash) => {
        await tenantPool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, id]);
        // Keep the central tenants row in sync for the primary admin (used at login).
        if (adminEmail && user?.tenant_id) {
          const t = await superAdminPool.query(
            'SELECT admin_email FROM public.tenants WHERE id = $1',
            [user.tenant_id],
          );
          const primary = t.rows[0]?.admin_email;
          if (primary && normalizeLoginId(primary) === normalizeLoginId(adminEmail)) {
            await superAdminPool.query('UPDATE public.tenants SET password_hash = $1 WHERE id = $2', [
              hash,
              user.tenant_id,
            ]);
          }
        }
      };
    }
  }

  if (!currentHash) throw ApiError.notFound('Account not found');

  const ok = await comparePassword(currentPassword, currentHash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  const newHash = await hashPassword(newPassword);
  await applyUpdate(newHash);

  return { message: 'Password updated successfully.' };
}

module.exports = {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  changePassword,
  verify2FA,
  verifyMfaLogin,
  login,
  generateImpersonationToken,
  getAccessProfile
};
