'use strict';

/**
 * Canonical permission slugs: module.action
 * Legacy UI keys (employee-directory, etc.) remain in DB and map here.
 */
const P = {
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_CREATE: 'employee.create',
  EMPLOYEE_EDIT: 'employee.edit',
  EMPLOYEE_DELETE: 'employee.delete',
  LEAVE_VIEW: 'leave.view',
  LEAVE_APPLY: 'leave.apply',
  LEAVE_APPROVE: 'leave.approve',
  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_UPLOAD: 'document.upload',
  PAYROLL_VIEW: 'payroll.view',
  ATTENDANCE_VIEW: 'attendance.view',
  PERFORMANCE_VIEW: 'performance.view',
  DEPARTMENTS_MANAGE: 'departments.manage',
  POLICIES_MANAGE: 'policies.manage',
  POLICIES_VIEW: 'policies.view',
  POLICIES_ACKNOWLEDGE: 'policies.acknowledge',
  VISA_VIEW: 'visa.view',
  VISA_MANAGE: 'visa.manage',
  MESSAGES_VIEW: 'messages.view',
  ASSETS_VIEW: 'assets.view',
  EXIT_VIEW: 'exit.view',
  EXIT_MANAGE: 'exit.manage',
};

/** Legacy rbac_permissions.key → action slug(s) that satisfy the check */
const LEGACY_KEY_TO_ACTIONS = {
  dashboard: ['dashboard'],
  'employee-directory': [P.EMPLOYEE_VIEW],
  'employee-profiles': [P.EMPLOYEE_VIEW, P.EMPLOYEE_EDIT],
  attendance: [P.ATTENDANCE_VIEW],
  'leave-absence': [P.LEAVE_VIEW, P.LEAVE_APPROVE],
  'documents-approval': [P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD],
  'visa-nationality': [P.VISA_VIEW, P.VISA_MANAGE],
  assets: ['assets.view'],
  performance: [P.PERFORMANCE_VIEW],
  policies: [P.POLICIES_MANAGE, P.POLICIES_VIEW, P.POLICIES_ACKNOWLEDGE],
  expenses: ['expenses.view'],
  'payroll-management': [P.PAYROLL_VIEW],
  departments: [P.DEPARTMENTS_MANAGE],
  designations: [P.DEPARTMENTS_MANAGE],
  messages: ['messages.view'],
  announcements: ['announcements.view'],
  'letter-templates': ['letter-templates'],
  'system-settings': ['system-settings'],
  'exit-management': [P.EXIT_VIEW, P.EXIT_MANAGE],
};

/** Action slug → legacy keys (for login allowedModules / sidebar) */
const ACTION_TO_LEGACY_KEYS = {
  [P.EMPLOYEE_VIEW]: ['employee-directory', 'employee-profiles'],
  [P.EMPLOYEE_CREATE]: ['employee-directory'],
  [P.EMPLOYEE_EDIT]: ['employee-profiles'],
  [P.EMPLOYEE_DELETE]: ['employee-directory'],
  [P.LEAVE_VIEW]: ['leave-absence'],
  [P.LEAVE_APPROVE]: ['leave-absence'],
  [P.DOCUMENT_VIEW]: ['documents-approval'],
  [P.DOCUMENT_UPLOAD]: ['documents-approval'],
  [P.PAYROLL_VIEW]: ['payroll-management'],
  [P.ATTENDANCE_VIEW]: ['attendance'],
  [P.PERFORMANCE_VIEW]: ['performance'],
  [P.DEPARTMENTS_MANAGE]: ['departments', 'designations'],
  [P.POLICIES_MANAGE]: ['policies'],
  [P.POLICIES_VIEW]: ['policies'],
  [P.POLICIES_ACKNOWLEDGE]: ['policies'],
  [P.VISA_VIEW]: ['visa-nationality'],
  [P.VISA_MANAGE]: ['visa-nationality'],
  [P.MESSAGES_VIEW]: ['messages'],
  [P.ASSETS_VIEW]: ['assets'],
  [P.EXIT_VIEW]: ['exit-management'],
  [P.EXIT_MANAGE]: ['exit-management'],
};

const DATA_SCOPES = Object.freeze(['SELF', 'TEAM', 'DEPARTMENT', 'ALL']);

function expandPermissionKeys(keys) {
  const out = new Set();
  for (const key of keys || []) {
    if (!key) continue;
    out.add(key);
    const actions = LEGACY_KEY_TO_ACTIONS[key];
    if (actions) actions.forEach((a) => out.add(a));
    if (ACTION_TO_LEGACY_KEYS[key]) {
      ACTION_TO_LEGACY_KEYS[key].forEach((l) => out.add(l));
    }
    for (const [legacy, actions] of Object.entries(LEGACY_KEY_TO_ACTIONS)) {
      if (actions.includes(key)) out.add(legacy);
    }
  }
  return out;
}

/**
 * Returns true if granted set satisfies required permission (slug or legacy key).
 */
function permissionSatisfied(grantedSet, requiredKey) {
  if (!requiredKey) return true;
  if (grantedSet.has(requiredKey)) return true;
  const viaLegacy = LEGACY_KEY_TO_ACTIONS[requiredKey];
  if (viaLegacy && viaLegacy.some((a) => grantedSet.has(a))) return true;
  for (const [legacy, actions] of Object.entries(LEGACY_KEY_TO_ACTIONS)) {
    if (actions.includes(requiredKey) && grantedSet.has(legacy)) return true;
  }
  return false;
}

/** Keys for frontend sidebar (legacy module keys) */
function toAllowedModuleKeys(grantedSet) {
  const modules = new Set(['dashboard']);
  for (const key of grantedSet) {
    if (LEGACY_KEY_TO_ACTIONS[key] || key.includes('.')) {
      const legacy = ACTION_TO_LEGACY_KEYS[key];
      if (legacy) legacy.forEach((l) => modules.add(l));
      else if (!key.includes('.')) modules.add(key);
    }
    if (ACTION_TO_LEGACY_KEYS[key]) {
      ACTION_TO_LEGACY_KEYS[key].forEach((l) => modules.add(l));
    }
  }
  for (const key of grantedSet) {
    if (!key.includes('.') && key !== 'dashboard') modules.add(key);
  }
  return Array.from(modules);
}

module.exports = {
  P,
  LEGACY_KEY_TO_ACTIONS,
  ACTION_TO_LEGACY_KEYS,
  DATA_SCOPES,
  expandPermissionKeys,
  permissionSatisfied,
  toAllowedModuleKeys,
};
