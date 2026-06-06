'use strict';

const ApiError = require('../../../utils/ApiError');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');

// ─── Scope helpers ────────────────────────────────────────────────────────────

/** Tenant-wide attendance view. */
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

function assertNotSelfApproval(auth, record, what = 'regularization request') {
  if (Number(record.employee_id) === Number(auth.employeeId)) {
    throw ApiError.forbidden(`You cannot approve your own ${what}`);
  }
}

async function loadEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT id, department, reporting_manager_id, department_id
     FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  return rows[0] || null;
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

// ─── Stage-based authorization ────────────────────────────────────────────────

/**
 * Determine which approval stage a record is currently at and assert the
 * calling user is authorized to act on that stage.
 *
 * Stages (shared by regularization and overtime):
 *   'Pending'          → Stage 1: Reporting Manager (or Dept Head if no manager)
 *   'Manager_Approved' → Stage 2: Department Head
 *   'Dept_Approved'    → Stage 3: HR / Admin
 *
 * @param {'regularization'|'overtime'} requestType  - human label for error messages
 * @param {string} currentStatus - the record's current regularization_status or overtime_status
 * @param {object} emp - employee row (must include reporting_manager_id, department_id, department)
 */
function assertCanActOnStage(auth, currentStatus, emp, action = 'approve', requestType = 'request') {
  if (!auth) throw ApiError.unauthorized('Not authenticated');

  // Override: tenant admins and attendance managers can always act.
  if (canOverrideApproval(auth)) return;

  if (!hasApprovalPermission(auth, action)) {
    throw ApiError.forbidden(`You do not have permission to process ${requestType}s`);
  }

  const hasManager = !!emp.reporting_manager_id;

  switch (currentStatus) {
    case 'Pending': {
      // Stage 1 — Reporting Manager is primary approver.
      // If the employee has no manager, Department Head steps in.
      if (hasManager) {
        if (!isDirectReport(auth, emp)) {
          throw ApiError.forbidden(
            `Only the direct reporting manager can act on this ${requestType} at stage 1`,
          );
        }
      } else {
        // No manager — dept head is stage-1 approver.
        if (!isInManagedDepartment(auth, emp) && !hasHrApprovalScope(auth)) {
          throw ApiError.forbidden(
            `No reporting manager assigned; only a department head or HR can approve this ${requestType}`,
          );
        }
      }
      return;
    }

    case 'Manager_Approved': {
      // Stage 2 — Department Head.
      if (!isInManagedDepartment(auth, emp) && !hasHrApprovalScope(auth)) {
        throw ApiError.forbidden(
          `Only the department head can act on this ${requestType} at stage 2`,
        );
      }
      return;
    }

    case 'Dept_Approved': {
      // Stage 3 — HR / Admin.
      if (!hasHrApprovalScope(auth)) {
        throw ApiError.forbidden(
          `Only HR or admin can give final approval for this ${requestType}`,
        );
      }
      return;
    }

    default:
      throw ApiError.badRequest(`${requestType} is not in a state that can be approved or rejected`);
  }
}

/**
 * Legacy step-based authorization kept for backward compatibility.
 * New code should use assertCanActOnStage instead.
 */
async function assertCanActOnPendingStep(auth, pool, record, pendingStep, action = 'approve') {
  if (!auth) throw ApiError.unauthorized('Not authenticated');
  if (!pendingStep) {
    throw ApiError.badRequest('No pending approval step for this regularization');
  }

  assertNotSelfApproval(auth, record);

  if (canOverrideApproval(auth)) return;

  if (!hasApprovalPermission(auth, action)) {
    throw ApiError.forbidden('You do not have permission to process regularizations');
  }

  const emp = await loadEmployee(pool, record.employee_id);
  if (!emp) throw ApiError.notFound('Employee not found');

  const r = String(pendingStep.approver_role || '').trim().toLowerCase();
  const isTeamLead = r === 'direct manager' || r === 'team lead' || r === 'team_lead' || r === 'direct_manager';
  const isManager  = r === 'manager';
  const isHr       = r === 'hr' || r === 'hr manager' || r === 'hr_manager';

  if (isTeamLead) {
    if (!isDirectReport(auth, emp)) {
      throw ApiError.forbidden('Only the direct reporting manager can act on this team-lead approval step');
    }
    return;
  }
  if (isManager) {
    if (!isInManagedDepartment(auth, emp)) {
      throw ApiError.forbidden('You can only approve regularizations for employees in your department');
    }
    return;
  }
  if (isHr) {
    if (!hasHrApprovalScope(auth)) {
      throw ApiError.forbidden('HR-level approval requires attendance.approve and attendance.view.all or attendance.manage');
    }
    return;
  }

  throw ApiError.forbidden('You cannot act on this approval step');
}

/** @deprecated Use assertCanActOnPendingStep */
async function assertCanApproveRegularization(auth, pool, record, pendingStep, action) {
  return assertCanActOnPendingStep(auth, pool, record, pendingStep, action);
}

module.exports = {
  canViewAll,
  canViewTeam,
  canViewOwn,
  hasHrApprovalScope,
  canOverrideApproval,
  hasApprovalPermission,
  assertNotSelfApproval,
  assertCanViewEmployee,
  assertCanModifyEmployee,
  assertCanActOnStage,
  assertCanActOnPendingStep,
  assertCanApproveRegularization,
  loadEmployee,
  isDirectReport,
  isInManagedDepartment,
};
