'use strict';

const ApiError = require('../../../utils/ApiError');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');
/** Maps attendance_settings.approver / chain labels → authorization kind */
const STEP_KIND = Object.freeze({
  TEAM_LEAD: 'team_lead',
  MANAGER: 'manager',
  HR: 'hr',
});

function normalizeStepKind(approverRole) {
  const r = String(approverRole || '').trim().toLowerCase();
  if (
    r === 'direct manager'
    || r === 'team lead'
    || r === 'team_lead'
    || r === 'direct_manager'
  ) {
    return STEP_KIND.TEAM_LEAD;
  }
  if (r === 'manager') {
    return STEP_KIND.MANAGER;
  }
  if (r === 'hr' || r === 'hr manager' || r === 'hr_manager') {
    return STEP_KIND.HR;
  }
  return null;
}

async function loadEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT id, department, reporting_manager_id, department_id
     FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  return rows[0] || null;
}

/** Tenant-wide attendance view (legacy attendance.view is NOT included). */
function canViewAll(auth) {
  return hasPermission(auth, P.ATTENDANCE_VIEW_ALL)
    || hasPermission(auth, P.ATTENDANCE_MANAGE);
}

function canViewTeam(auth) {
  return canViewAll(auth) || hasPermission(auth, P.ATTENDANCE_VIEW_TEAM);
}

function canViewOwn(auth) {
  return canViewTeam(auth) || hasPermission(auth, P.ATTENDANCE_VIEW_OWN);
}

function hasApprovalPermission(auth, action) {
  if (action === 'reject') {
    return hasPermission(auth, P.ATTENDANCE_REJECT) || hasPermission(auth, P.ATTENDANCE_APPROVE);
  }
  return hasPermission(auth, P.ATTENDANCE_APPROVE);
}

/** HR / global approvers: approve + (view.all OR manage). */
function hasHrApprovalScope(auth) {
  return (
    hasPermission(auth, P.ATTENDANCE_APPROVE)
    && (canViewAll(auth) || hasPermission(auth, P.ATTENDANCE_MANAGE))
  );
}

function canOverrideApproval(auth) {
  return auth?.isTenantAdmin || hasPermission(auth, P.ATTENDANCE_MANAGE);
}

function isDirectReport(auth, employeeRow) {
  return Number(employeeRow.reporting_manager_id) === Number(auth.employeeId);
}

function isInManagedDepartment(auth, employeeRow) {
  if (
    auth.managedDepartmentId
    && employeeRow.department_id != null
    && Number(employeeRow.department_id) === Number(auth.managedDepartmentId)
  ) {
    return true;
  }
  if (
    auth.scope === 'DEPARTMENT'
    && auth.department
    && String(employeeRow.department || '').trim() === String(auth.department).trim()
  ) {
    return true;
  }
  if (
    auth.scope === 'DEPT_MANAGER'
    && auth.managedDepartmentId
    && employeeRow.department_id != null
    && Number(employeeRow.department_id) === Number(auth.managedDepartmentId)
  ) {
    return true;
  }
  return false;
}

function assertNotSelfApproval(auth, record) {
  if (Number(record.employee_id) === Number(auth.employeeId)) {
    throw ApiError.forbidden('You cannot approve your own regularization request');
  }
}

async function assertCanViewEmployee(auth, pool, employeeId) {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (auth.isTenantAdmin || canViewAll(auth)) return;

  const emp = await loadEmployee(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  if (Number(auth.employeeId) === Number(employeeId) && canViewOwn(auth)) return;

  if (canViewTeam(auth)) {
    try {
      assertEmployeeRecordAccess(auth, emp);
      return;
    } catch (_e) {
      /* fall through */
    }
  }

  throw ApiError.forbidden('You do not have permission to view this attendance');
}

async function assertCanModifyEmployee(auth, pool, employeeId) {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (auth.isTenantAdmin || hasPermission(auth, P.ATTENDANCE_MANAGE)) return;
  if (hasPermission(auth, P.ATTENDANCE_UPDATE) && canViewAll(auth)) return;

  const emp = await loadEmployee(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  if (
    Number(auth.employeeId) === Number(employeeId)
    && (hasPermission(auth, P.ATTENDANCE_CREATE) || hasPermission(auth, P.ATTENDANCE_UPDATE))
  ) {
    return;
  }

  if (hasPermission(auth, P.ATTENDANCE_UPDATE)) {
    assertEmployeeRecordAccess(auth, emp);
    return;
  }

  throw ApiError.forbidden('You do not have permission to modify this attendance');
}

/**
 * Enforce pending workflow step + hierarchy (service-layer; do not rely on routes).
 * @param {object} pendingStep - row from attendance_regularization_steps
 */
async function assertCanActOnPendingStep(auth, pool, record, pendingStep, action = 'approve') {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (!pendingStep) {
    throw ApiError.badRequest('No pending approval step for this regularization');
  }

  assertNotSelfApproval(auth, record);

  if (canOverrideApproval(auth)) {
    return;
  }

  if (!hasApprovalPermission(auth, action)) {
    throw ApiError.forbidden('You do not have permission to process regularizations');
  }

  const emp = await loadEmployee(pool, record.employee_id);
  if (!emp) throw ApiError.notFound('Employee not found');

  const stepKind = normalizeStepKind(pendingStep.approver_role);
  if (!stepKind) {
    throw ApiError.badRequest('Invalid approval workflow step configuration');
  }

  switch (stepKind) {
    case STEP_KIND.TEAM_LEAD:
      if (!isDirectReport(auth, emp)) {
        throw ApiError.forbidden(
          'Only the direct reporting manager can act on this team-lead approval step',
        );
      }
      return;

    case STEP_KIND.MANAGER:
      if (!isInManagedDepartment(auth, emp)) {
        throw ApiError.forbidden(
          'You can only approve regularizations for employees in your department',
        );
      }
      return;

    case STEP_KIND.HR:
      if (!hasHrApprovalScope(auth)) {
        throw ApiError.forbidden(
          'HR-level approval requires attendance.approve and attendance.view.all or attendance.manage',
        );
      }
      return;

    default:
      throw ApiError.forbidden('You cannot act on this approval step');
  }
}

/** @deprecated Use assertCanActOnPendingStep — kept for callers that pre-load step */
async function assertCanApproveRegularization(auth, pool, record, pendingStep, action) {
  if (!pendingStep) {
    throw ApiError.badRequest('No pending approval step for this regularization');
  }
  return assertCanActOnPendingStep(auth, pool, record, pendingStep, action);
}

module.exports = {
  STEP_KIND,
  normalizeStepKind,
  canViewAll,
  canViewTeam,
  canViewOwn,
  hasHrApprovalScope,
  canOverrideApproval,
  assertCanViewEmployee,
  assertCanModifyEmployee,
  assertCanActOnPendingStep,
  assertCanApproveRegularization,
  loadEmployee,
  isDirectReport,
  isInManagedDepartment,
};
