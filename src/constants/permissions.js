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
  ATTENDANCE_VIEW_OWN: 'attendance.view.own',
  ATTENDANCE_VIEW_TEAM: 'attendance.view.team',
  ATTENDANCE_VIEW_ALL: 'attendance.view.all',
  ATTENDANCE_CREATE: 'attendance.create',
  ATTENDANCE_UPDATE: 'attendance.update',
  ATTENDANCE_REGULARIZATION_REQUEST: 'attendance.regularization.request',
  ATTENDANCE_APPROVE: 'attendance.approve',
  ATTENDANCE_REJECT: 'attendance.reject',
  ATTENDANCE_MANAGE: 'attendance.manage',
  ATTENDANCE_SETTINGS_VIEW: 'attendance.settings.view',
  ATTENDANCE_SETTINGS_MANAGE: 'attendance.settings.manage',
  PERFORMANCE_VIEW: 'performance.view',
  PERFORMANCE_VIEW_OWN: 'performance.view.own',
  PERFORMANCE_VIEW_TEAM: 'performance.view.team',
  PERFORMANCE_MANAGE: 'performance.manage',
  PERFORMANCE_REVIEW: 'performance.review',
  PERFORMANCE_APPROVE: 'performance.approve',
  DEPARTMENTS_MANAGE: 'departments.manage',
  POLICIES_MANAGE: 'policies.manage',
  POLICIES_VIEW: 'policies.view',
  POLICIES_ACKNOWLEDGE: 'policies.acknowledge',
  VISA_VIEW: 'visa.view',
  VISA_MANAGE: 'visa.manage',
  MESSAGES_VIEW: 'messages.view',
  ASSETS_VIEW: 'assets.view',
  ASSETS_CREATE: 'assets.create',
  ASSETS_EDIT: 'assets.edit',
  ASSETS_DELETE: 'assets.delete',
  ASSETS_ASSIGN: 'assets.assign',
  ASSETS_RETURN: 'assets.return',
  ONBOARDING_VIEW: 'onboarding.view',
  ONBOARDING_MANAGE: 'onboarding.manage',
  TASKS_MANAGE: 'tasks',
  EXIT_VIEW: 'exit.view',
  EXIT_MANAGE: 'exit.manage',
  EXIT_TERMINATE: 'exit.terminate',
};

/** Legacy rbac_permissions.key → action slug(s) that satisfy the check */
const LEGACY_KEY_TO_ACTIONS = {
  dashboard: ['dashboard'],
  'employee-directory': [P.EMPLOYEE_VIEW],
  'employee-profiles': [P.EMPLOYEE_VIEW, P.EMPLOYEE_EDIT],
  attendance: [
    P.ATTENDANCE_VIEW,
    P.ATTENDANCE_VIEW_ALL,
    P.ATTENDANCE_VIEW_TEAM,
    P.ATTENDANCE_VIEW_OWN,
    P.ATTENDANCE_CREATE,
    P.ATTENDANCE_REGULARIZATION_REQUEST,
    P.ATTENDANCE_APPROVE,
    P.ATTENDANCE_REJECT,
    P.ATTENDANCE_MANAGE,
    P.ATTENDANCE_SETTINGS_VIEW,
    P.ATTENDANCE_SETTINGS_MANAGE,
  ],
  'attendance.view': [
    P.ATTENDANCE_VIEW,
    P.ATTENDANCE_VIEW_OWN,
  ],
  'time-tracking': [
    P.ATTENDANCE_VIEW_OWN,
    P.ATTENDANCE_CREATE,
    P.ATTENDANCE_REGULARIZATION_REQUEST,
  ],
  'shift-management': [P.ATTENDANCE_VIEW_TEAM, P.ATTENDANCE_VIEW_OWN],
  'overtime-management': [P.ATTENDANCE_VIEW_TEAM, P.ATTENDANCE_VIEW_ALL],
  'leave-absence': [P.LEAVE_VIEW, P.LEAVE_APPLY, P.LEAVE_APPROVE],
  'documents-approval': [P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD],
  'visa-nationality': [P.VISA_VIEW, P.VISA_MANAGE],
  assets: [
    'assets.view',
    P.ASSETS_VIEW,
    P.ASSETS_CREATE,
    P.ASSETS_EDIT,
    P.ASSETS_DELETE,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
  ],
  onboarding: [P.ONBOARDING_VIEW, P.ONBOARDING_MANAGE],
  performance: [
    P.PERFORMANCE_VIEW,
    P.PERFORMANCE_VIEW_OWN,
    P.PERFORMANCE_VIEW_TEAM,
    P.PERFORMANCE_MANAGE,
    P.PERFORMANCE_REVIEW,
    P.PERFORMANCE_APPROVE,
  ],
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
  tasks: [P.TASKS_MANAGE],
};

/** Action slug → legacy keys (for login allowedModules / sidebar) */
const ACTION_TO_LEGACY_KEYS = {
  [P.EMPLOYEE_VIEW]: ['employee-directory', 'employee-profiles'],
  [P.EMPLOYEE_CREATE]: ['employee-directory'],
  [P.EMPLOYEE_EDIT]: ['employee-profiles'],
  [P.EMPLOYEE_DELETE]: ['employee-directory'],
  [P.LEAVE_VIEW]: ['leave-absence'],
  [P.LEAVE_APPLY]: ['leave-absence'],
  [P.LEAVE_APPROVE]: ['leave-absence'],
  [P.DOCUMENT_VIEW]: ['documents-approval'],
  [P.DOCUMENT_UPLOAD]: ['documents-approval'],
  [P.PAYROLL_VIEW]: ['payroll-management'],
  [P.ATTENDANCE_VIEW]: ['attendance'],
  [P.ATTENDANCE_VIEW_OWN]: ['attendance'],
  [P.ATTENDANCE_VIEW_TEAM]: ['attendance'],
  [P.ATTENDANCE_VIEW_ALL]: ['attendance'],
  [P.ATTENDANCE_CREATE]: ['attendance'],
  [P.ATTENDANCE_UPDATE]: ['attendance'],
  [P.ATTENDANCE_REGULARIZATION_REQUEST]: ['attendance'],
  [P.ATTENDANCE_APPROVE]: ['attendance'],
  [P.ATTENDANCE_REJECT]: ['attendance'],
  [P.ATTENDANCE_MANAGE]: ['attendance'],
  [P.ATTENDANCE_SETTINGS_VIEW]: ['attendance'],
  [P.ATTENDANCE_SETTINGS_MANAGE]: ['attendance'],
  [P.PERFORMANCE_VIEW]: ['performance'],
  [P.PERFORMANCE_VIEW_OWN]: ['performance'],
  [P.PERFORMANCE_VIEW_TEAM]: ['performance'],
  [P.PERFORMANCE_MANAGE]: ['performance'],
  [P.PERFORMANCE_REVIEW]: ['performance'],
  [P.PERFORMANCE_APPROVE]: ['performance'],
  [P.DEPARTMENTS_MANAGE]: ['departments', 'designations'],
  [P.POLICIES_MANAGE]: ['policies'],
  [P.POLICIES_VIEW]: ['policies'],
  [P.POLICIES_ACKNOWLEDGE]: ['policies'],
  [P.VISA_VIEW]: ['visa-nationality'],
  [P.VISA_MANAGE]: ['visa-nationality'],
  [P.MESSAGES_VIEW]: ['messages'],
  [P.ASSETS_VIEW]: ['assets'],
  [P.ASSETS_CREATE]: ['assets'],
  [P.ASSETS_EDIT]: ['assets'],
  [P.ASSETS_DELETE]: ['assets'],
  [P.ASSETS_ASSIGN]: ['assets'],
  [P.ASSETS_RETURN]: ['assets'],
  [P.ONBOARDING_VIEW]: ['onboarding'],
  [P.ONBOARDING_MANAGE]: ['onboarding'],
  [P.TASKS_MANAGE]: ['tasks'],
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

/** Sidebar legacy keys + explicit permission slugs for strict UI gates */
function toAllowedModulesForJwt(grantedSet) {
  const set = new Set(['dashboard']);
  for (const key of grantedSet || []) {
    if (key) set.add(key);
  }
  for (const key of toAllowedModuleKeys(grantedSet)) {
    set.add(key);
  }
  return Array.from(set);
}

module.exports = {
  P,
  LEGACY_KEY_TO_ACTIONS,
  ACTION_TO_LEGACY_KEYS,
  DATA_SCOPES,
  expandPermissionKeys,
  permissionSatisfied,
  toAllowedModuleKeys,
  toAllowedModulesForJwt,
};
