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
      decoded = jwt.verify(token, env.JWT_SECRET);
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
      tenant_id: decoded.tenant_id || null,
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

module.exports = {
  authenticate,
  requireRole,
};
