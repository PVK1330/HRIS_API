"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");

function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization;
    if (
      !header ||
      typeof header !== "string" ||
      !header.startsWith("Bearer ")
    ) {
      return next(
        ApiError.unauthorized("Authorization Bearer token is required"),
      );
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return next(
        ApiError.unauthorized("Authorization Bearer token is required"),
      );
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT.secret);
    } catch (err) {
      const msg =
        err && err.name === "TokenExpiredError"
          ? "Token has expired"
          : "Invalid or malformed token";
      return next(ApiError.unauthorized(msg));
    }

    if (!decoded || !decoded.id || !decoded.role) {
      return next(ApiError.unauthorized("Invalid token payload"));
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      rbacRoleId: decoded.rbacRoleId || null,
      tenant_id: decoded.tenant_id || null,
      db_name: decoded.db_name || null,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

const { getTenantPool } = require("../config/db");

function requireRole(...allowedRoles) {
  const allowed = allowedRoles.flat().filter(Boolean);
  return function roleGuard(req, _res, next) {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized("Authentication required"));
    }
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden("You do not have permission to perform this action"),
      );
    }
    return next();
  };
}

/**
 * Dynamic Permission Middleware
 * Checks if the user's role has a specific permission in the tenant database.
 * System roles 'superadmin' and 'admin' (tenant owner) bypass these checks.
 */
function requirePermission(permissionKey) {
  return async function permissionGuard(req, _res, next) {
    try {
      const { user, tenant } = req;
      if (!user) return next(ApiError.unauthorized("Authentication required"));

      // System admins have full access
      if (user.role === "superadmin" || user.role === "admin") {
        return next();
      }

      // If user has no rbac_role_id in JWT, we might need to fetch it or deny
      // Currently, employee portal users have role='employee' and rbacRoleId in profile
      // But for simplicity, we check the rbac_role_permissions table
      if (!user.rbacRoleId && user.role !== 'employee') {
        return next(ApiError.forbidden("No access role assigned"));
      }

      const pool = await getTenantPool(tenant.dbName);
      const { rows } = await pool.query(
        `
        SELECT COUNT(*) 
        FROM rbac_role_permissions rp
        JOIN rbac_permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.key = $2
        `,
        [user.rbacRoleId, permissionKey]
      );

      if (parseInt(rows[0].count, 10) > 0) {
        return next();
      }

      return next(ApiError.forbidden(`Missing required permission: ${permissionKey}`));
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
};
