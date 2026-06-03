'use strict';

const ApiError = require('../utils/ApiError');
const authz = require('../services/authz.service');
const { permissionSatisfied } = require('../constants/permissions');

const ORG_SETTINGS_KEYS = [
  'system-settings',
  'settings',
  'attendance.settings.manage',
  'attendance.manage',
];

/**
 * Organization settings routes: allow tenant JWT admin or RBAC system-settings / attendance settings manage.
 * Replaces hardcoded req.user.role === 'admin' checks.
 */
function requireOrgSettingsAccess(req, _res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'superadmin') {
    return next();
  }

  const auth = req.auth;
  if (!auth?.permissions) {
    return next(
      ApiError.forbidden(
        'Organization settings access required. Assign the system-settings permission to this role.',
      ),
    );
  }

  const ok = ORG_SETTINGS_KEYS.some((k) => permissionSatisfied(auth.permissions, k));
  if (ok) return next();

  return next(
    ApiError.forbidden(
      'Organization settings access required. HR and other roles need the system-settings permission.',
    ),
  );
}

module.exports = { requireOrgSettingsAccess };
