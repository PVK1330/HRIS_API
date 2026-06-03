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
      if (approver !== 'Direct Manager') {
        chain.push('Direct Manager');
      }
      if (!chain.includes(approver)) {
        chain.push(approver);
      }
      return chain.length ? chain : [approver];
    }

    case WORKFLOW_TYPES.THREE:
    case WORKFLOW_TYPES.CUSTOM: {
      const chain = [];
      if (approver !== 'Direct Manager') {
        chain.push('Direct Manager');
      }
      if (
        approver !== 'Direct Manager'
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

module.exports = {
  buildApprovalChain,
  VALID_APPROVERS,
};
