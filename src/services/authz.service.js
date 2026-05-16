'use strict';

const { getTenantPool } = require('../config/db');
const {
  expandPermissionKeys,
  permissionSatisfied,
  toAllowedModuleKeys,
  DATA_SCOPES,
} = require('../constants/permissions');
const rbacRepo = require('../modules/rbac/rbac.repository');

async function allPermissionKeys(pool) {
  const { rows } = await pool.query(
    `SELECT key FROM rbac_permissions ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map((r) => r.key);
}

async function getScopeForRole(pool, rbacRoleId) {
  if (rbacRoleId == null) return 'SELF';
  try {
    const { rows } = await pool.query(
      `SELECT scope FROM role_data_scopes WHERE role_id = $1 LIMIT 1`,
      [rbacRoleId],
    );
    if (rows.length && DATA_SCOPES.includes(rows[0].scope)) {
      return rows[0].scope;
    }
  } catch (_e) {
    /* table may not exist before migration 038 */
  }
  return 'SELF';
}

async function loadEmployeeContext(pool, employeeId) {
  if (!employeeId) return { department: null };
  const { rows } = await pool.query(
    `SELECT id, department, reporting_manager_id, rbac_role_id
     FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  return rows[0] || { department: null };
}

/**
 * Build authorization context for the current request user.
 * @param {object} user - req.user from JWT
 * @returns {Promise<object>}
 */
async function loadAuthContext(user) {
  if (!user?.db_name) {
    return {
      permissions: new Set(),
      scope: 'SELF',
      isTenantAdmin: false,
      employeeId: null,
      department: null,
    };
  }

  const pool = getTenantPool(user.db_name);
  const isTenantAdmin = user.role === 'admin' || user.role === 'superadmin';

  if (isTenantAdmin) {
    const keys = await allPermissionKeys(pool);
    return {
      userId: user.id,
      role: user.role,
      rbacRoleId: user.rbacRoleId || null,
      employeeId: user.employeeId || null,
      department: user.department || null,
      permissions: expandPermissionKeys(keys),
      scope: 'ALL',
      isTenantAdmin: true,
    };
  }

  const rbacRoleId = user.rbacRoleId || null;
  let employeeId = user.employeeId || null;
  let department = user.department || null;

  if (user.role === 'employee' && employeeId) {
    const emp = await loadEmployeeContext(pool, employeeId);
    department = emp.department || department;
    if (!rbacRoleId && emp.rbac_role_id) {
      user.rbacRoleId = emp.rbac_role_id;
    }
  }

  const roleId = user.rbacRoleId || rbacRoleId;
  const rawKeys = roleId
    ? await rbacRepo.permissionKeysForRole(pool, roleId)
    : [];
  const permissions = expandPermissionKeys(rawKeys);
  const scope = roleId ? await getScopeForRole(pool, roleId) : 'SELF';

  return {
    userId: user.id,
    role: user.role,
    rbacRoleId: roleId,
    employeeId,
    department,
    permissions,
    scope,
    isTenantAdmin: false,
  };
}

function hasPermission(auth, permissionKey) {
  if (!permissionKey) return true;
  if (auth?.isTenantAdmin) return true;
  if (!auth?.permissions) return false;
  return permissionSatisfied(auth.permissions, permissionKey);
}

function allowedModulesFromAuth(auth) {
  if (auth?.isTenantAdmin) {
    return null; /* caller may use full list */
  }
  return toAllowedModuleKeys(auth?.permissions || new Set());
}

module.exports = {
  loadAuthContext,
  hasPermission,
  allowedModulesFromAuth,
  getScopeForRole,
  allPermissionKeys,
};
