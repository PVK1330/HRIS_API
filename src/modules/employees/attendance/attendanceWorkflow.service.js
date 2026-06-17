'use strict';

const { WORKFLOW_TYPES } = require('./attendance.constants');
const { APPROVERS } = require('../../attendanceSettings/attendanceSettings.options');

const VALID_APPROVERS = new Set(APPROVERS);

/**
 * Build approval chain from attendance_settings (approver + approval_workflow_type).
 * Role labels are stored as configured in settings — not hardcoded TL/Manager/HR constants.
 */
function buildApprovalChain(settings) {
  const primary = String(settings?.approver || 'HR').trim();
  const approver = VALID_APPROVERS.has(primary) ? primary : 'HR';
  const type = settings?.approval_workflow_type || WORKFLOW_TYPES.TWO;

  switch (type) {
    case WORKFLOW_TYPES.SINGLE:
      return [approver];

    case WORKFLOW_TYPES.TWO: {
      const chain = [];
      if (approver !== 'Reporting Manager') {
        chain.push('Reporting Manager');
      }
      if (!chain.includes(approver)) {
        chain.push(approver);
      }
      return chain.length ? chain : [approver];
    }

    case WORKFLOW_TYPES.THREE:
    case WORKFLOW_TYPES.CUSTOM: {
      const chain = [];
      if (approver !== 'Reporting Manager') {
        chain.push('Reporting Manager');
      }
      if (
        approver !== 'Reporting Manager'
        && approver !== 'Manager'
        && !chain.includes('Manager')
      ) {
        chain.push('Manager');
      }
      if (!chain.includes(approver)) {
        chain.push(approver);
      }
      return chain.length ? chain : [approver];
    }

    default:
      return buildApprovalChain({
        ...settings,
        approval_workflow_type: WORKFLOW_TYPES.TWO,
      });
  }
}

/**
 * Build the ORDERED active approval stages for the column-based regularization model.
 * Stages are a subset of ['manager','department','hr'], derived from approval_workflow_type
 * and pruned to stages that actually have a possible approver for this employee:
 *   - 'manager'    requires emp.reporting_manager_id
 *   - 'department' requires emp.department_id
 *   - 'hr'         always available (final authority)
 * @returns {Array<'manager'|'department'|'hr'>}
 */
function buildStageChain(settings, emp) {
  const type = settings?.approval_workflow_type || WORKFLOW_TYPES.TWO;

  let stages;
  switch (type) {
    case WORKFLOW_TYPES.SINGLE:
      stages = ['hr'];
      break;
    case WORKFLOW_TYPES.THREE:
    case WORKFLOW_TYPES.CUSTOM:
      stages = ['manager', 'department', 'hr'];
      break;
    case WORKFLOW_TYPES.TWO:
    default:
      stages = ['manager', 'hr'];
      break;
  }

  const active = stages.filter((s) => {
    if (s === 'manager') return Boolean(emp?.reporting_manager_id);
    if (s === 'department') return emp?.department_id != null;
    return true; // hr
  });

  return active.length ? active : ['hr'];
}

module.exports = {
  buildApprovalChain,
  buildStageChain,
  VALID_APPROVERS,
};
