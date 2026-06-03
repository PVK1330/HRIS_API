'use strict';

const ApiError = require('../../utils/ApiError');
const { hasPermission } = require('../../services/authz.service');
const { P } = require('../../constants/permissions');

function canViewSettings(auth) {
  if (!auth) return false;
  return (
    hasPermission(auth, P.ATTENDANCE_SETTINGS_VIEW)
    || hasPermission(auth, P.ATTENDANCE_SETTINGS_MANAGE)
    || hasPermission(auth, P.ATTENDANCE_MANAGE)
  );
}

function canManageSettings(auth) {
  if (!auth) return false;
  return (
    hasPermission(auth, P.ATTENDANCE_SETTINGS_MANAGE)
    || hasPermission(auth, P.ATTENDANCE_MANAGE)
  );
}

function assertCanViewSettings(auth) {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (!canViewSettings(auth)) {
    throw ApiError.forbidden('Missing permission: attendance.settings.view');
  }
}

function assertCanManageSettings(auth) {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (!canManageSettings(auth)) {
    throw ApiError.forbidden('Missing permission: attendance.settings.manage');
  }
}

module.exports = {
  canViewSettings,
  canManageSettings,
  assertCanViewSettings,
  assertCanManageSettings,
};
