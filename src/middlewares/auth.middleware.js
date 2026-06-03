'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { getTenantPool } = require('../config/db');
const authz = require('../services/authz.service');
const { permissionSatisfied } = require('../constants/permissions');

function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization;
    if (
      !header ||
      typeof header !== 'string' ||
      !header.startsWith('Bearer ')
    ) {
      return next(
        ApiError.unauthorized('Authorization Bearer token is required'),
      );
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return next(
        ApiError.unauthorized('Authorization Bearer token is required'),
      );
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT.secret);
    } catch (err) {
      const msg =
        err && err.name === 'TokenExpiredError'
          ? 'Token has expired'
          : 'Invalid or malformed token';
      return next(ApiError.unauthorized(msg));
    }

    if (!decoded || !decoded.id || !decoded.role) {
      return next(ApiError.unauthorized('Invalid token payload'));
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name || null,
      role: decoded.role,
      rbacRoleId: decoded.rbacRoleId || null,
      tenant_id: decoded.tenant_id || null,
      db_name: decoded.db_name || null,
      employeeId: decoded.employeeId || null,
      department: decoded.department || null,
      userType: decoded.userType || decoded.role,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

function requireRole(...allowedRoles) {
  const allowed = allowedRoles.flat().filter(Boolean);
  return function roleGuard(req, _res, next) {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    const role = String(req.user.role);
    if (allowed.includes(role)) {
      return next();
    }
    /* Legacy route roles map to tenant admin JWT */
    if (
      allowed.some((r) => ['hr_admin', 'hr_executive', 'manager', 'hr'].includes(r)) &&
      role === 'admin'
    ) {
      return next();
    }
    if (allowed.includes('employee') && role === 'employee') {
      return next();
    }
    return next(
      ApiError.forbidden('You do not have permission to perform this action'),
    );
  };
}

/**
 * Load permissions + data scope onto req.auth (run after authenticate).
 */
function loadAuthContext(req, _res, next) {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }
  authz
    .loadAuthContext(req.user)
    .then((ctx) => {
      req.auth = ctx;
      next();
    })
    .catch(next);
}

/**
 * Dynamic permission check (module.action slug or legacy module key).
 * Tenant admin / superadmin bypass. Uses req.auth if loadAuthContext ran, else loads on demand.
 */
function requirePermission(permissionKey) {
  return async function permissionGuard(req, _res, next) {
    try {
      const { user } = req;
      if (!user) return next(ApiError.unauthorized('Authentication required'));

      if (user.role === 'superadmin') {
        return next();
      }

      let auth = req.auth;
      if (!auth) {
        auth = await authz.loadAuthContext(user);
        req.auth = auth;
      }

      if (auth.isTenantAdmin || permissionSatisfied(auth.permissions, permissionKey)) {
        return next();
      }

      /* Fallback: DB lookup when JWT lacked rbacRoleId */
      const dbName = req.tenant?.dbName || user.db_name;
      if (!dbName) {
        return next(ApiError.forbidden(`Missing required permission: ${permissionKey}`));
      }

      const pool = getTenantPool(dbName);
      const roleId = user.rbacRoleId;
      if (!roleId) {
        return next(ApiError.forbidden(`Missing required permission: ${permissionKey}`));
      }

      const rbacRepo = require('../modules/rbac/rbac.repository');
      const keys = await rbacRepo.permissionKeysForRole(pool, roleId);
      const expanded = require('../constants/permissions').expandPermissionKeys(keys);
      if (permissionSatisfied(expanded, permissionKey)) {
        auth.permissions = expanded;
        return next();
      }

      return next(ApiError.forbidden(`Missing required permission: ${permissionKey}`));
    } catch (err) {
      return next(err);
    }
  };
}

/** Require at least one of the given permissions */
function requireAnyPermission(...permissionKeys) {
  const keys = permissionKeys.flat().filter(Boolean);
  return async function anyPermissionGuard(req, _res, next) {
    try {
      const { user } = req;
      if (!user) return next(ApiError.unauthorized('Authentication required'));
      if (user.role === 'superadmin') {
        return next();
      }

      let auth = req.auth;
      if (!auth) {
        auth = await authz.loadAuthContext(user);
        req.auth = auth;
      }

      const ok = auth.isTenantAdmin || keys.some((k) => permissionSatisfied(auth.permissions, k));
      if (ok) return next();

      return next(
        ApiError.forbidden(`Missing required permission (one of): ${keys.join(', ')}`),
      );
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  authenticate,
  requireRole,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
};
