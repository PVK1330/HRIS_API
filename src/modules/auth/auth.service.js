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

function normalizeLoginId(raw) {
  return String(raw || '').trim().toLowerCase();
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
          LOWER(TRIM(work_email)) = $1
          OR LOWER(TRIM(COALESCE(username, ''))) = $1
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
      WHERE LOWER(TRIM(email)) = $1
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

async function buildEmployeeLoginResult(emp, tenant, tenantPool, tenantFeatures, planDetails, planFeatures) {
  const rbacRepo = require('../rbac/rbac.repository');
  let allowedModules = ['dashboard'];
  if (emp.rbac_role_id) {
    const keys = await rbacRepo.permissionKeysForRole(tenantPool, emp.rbac_role_id);
    const expanded = expandPermissionKeys(keys);
    allowedModules = toAllowedModuleKeys(expanded);
    if (!allowedModules.includes('dashboard')) {
      allowedModules = ['dashboard', ...allowedModules];
    }
  }

  const token = jwt.sign(
    {
      id: emp.id,
      email: emp.work_email,
      role: 'employee',
      tenant_id: tenant.id,
      db_name: tenant.db_name,
      rbacRoleId: emp.rbac_role_id || null,
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
      rbacRoleId: emp.rbac_role_id,
      employeeId: emp.id,
      department: emp.department || null,
    },
    plan_details: planDetails,
    plan_features: planFeatures,
    tenant_features: tenantFeatures,
    allowedModules,
  };
}

async function buildAdminLoginResult(adminUser, tenant, tenantPool, tenantFeatures, planDetails, planFeatures) {
  const allowedModules = await adminModulesForJwt(tenantPool);
  const token = jwt.sign(
    {
      id: adminUser.id,
      email: adminUser.email,
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
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: 'admin',
      tenantId: tenant.id,
      tenantName: tenant.name,
    },
    plan_details: planDetails,
    plan_features: planFeatures,
    tenant_features: tenantFeatures,
    allowedModules,
  };
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
    'SELECT id, name, db_name, status, plan_id FROM public.tenants WHERE LOWER(TRIM(admin_email)) = $1',
    [loginId],
  );

  if (centralResult.rows.length === 0) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const centralTenant = centralResult.rows[0];
  if (centralTenant.status !== 'active') {
    throw ApiError.unauthorized('Account is suspended or inactive');
  }

  const tenantPool = getTenantPool(centralTenant.db_name);
  await runTenantMigrations(centralTenant.db_name).catch(() => { });

  const userResult = await tenantPool.query(
    'SELECT id, email, password_hash, name, status FROM admin_users WHERE LOWER(TRIM(email)) = $1',
    [loginId],
  );

  if (userResult.rows.length === 0) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const user = userResult.rows[0];
  if (user.status !== 'active') {
    throw ApiError.unauthorized('User account is inactive');
  }

  const passwordMatches = await comparePassword(password, user.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const tenantFeatures = await gatherTenantFeatures(centralTenant.id);
  const { planDetails, planFeatures } = await fetchPlanBundles(centralTenant.plan_id);

  return buildAdminLoginResult(
    user,
    centralTenant,
    tenantPool,
    tenantFeatures,
    planDetails,
    planFeatures,
  );
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
  const tenantPool = getTenantPool(tenant.db_name);
  if (currentUser.role === 'admin') {
    allowedModules = await adminModulesForJwt(tenantPool);
  } else if (currentUser.rbacRoleId) {
    const keys = await rbacRepo.permissionKeysForRole(tenantPool, currentUser.rbacRoleId);
    const expanded = expandPermissionKeys(keys);
    allowedModules = toAllowedModuleKeys(expanded);
    if (!allowedModules.includes('dashboard')) {
      allowedModules = ['dashboard', ...allowedModules];
    }
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
