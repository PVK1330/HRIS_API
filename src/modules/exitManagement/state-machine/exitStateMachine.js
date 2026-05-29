'use strict';

const ApiError = require('../../../utils/ApiError');

const STATES = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_APPROVAL: 'In_Approval',
  CLEARANCE_PENDING: 'Clearance_Pending',
  FNF_PENDING: 'FnF_Pending',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn'
};

const TRANSITIONS = {
  [STATES.DRAFT]: [STATES.SUBMITTED],
  [STATES.SUBMITTED]: [STATES.IN_APPROVAL, STATES.REJECTED, STATES.WITHDRAWN],
  [STATES.IN_APPROVAL]: [STATES.CLEARANCE_PENDING, STATES.REJECTED, STATES.WITHDRAWN],
  [STATES.CLEARANCE_PENDING]: [STATES.FNF_PENDING, STATES.WITHDRAWN],
  [STATES.FNF_PENDING]: [STATES.COMPLETED],
  [STATES.COMPLETED]: [],
  [STATES.REJECTED]: [],
  [STATES.WITHDRAWN]: []
};

/**
 * Validates if a transition is allowed
 */
function validateTransition(currentStatus, nextStatus) {
  const allowed = TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Invalid workflow state transition from ${currentStatus} to ${nextStatus}`);
  }
}

/**
 * Analyzes active steps and determines the next high-level workflow status
 */
function determineNextWorkflowStatus(currentStatus, steps) {
  // If no steps, we assume it's just submitted and waiting
  if (!steps || steps.length === 0) return currentStatus;

  const pendingApprovals = steps.filter(s => s.step_type === 'Approval' && s.status !== 'Approved' && s.status !== 'Skipped');
  const pendingClearances = steps.filter(s => s.step_type === 'Clearance' && s.status !== 'Approved' && s.status !== 'Skipped');
  const pendingFnf = steps.filter(s => s.step_type === 'FnF' && s.status !== 'Approved' && s.status !== 'Skipped');

  if (currentStatus === STATES.SUBMITTED) {
    if (pendingApprovals.length > 0) return STATES.IN_APPROVAL;
    if (pendingClearances.length > 0) return STATES.CLEARANCE_PENDING;
    if (pendingFnf.length > 0) return STATES.FNF_PENDING;
    return STATES.COMPLETED;
  }

  if (currentStatus === STATES.IN_APPROVAL) {
    if (pendingApprovals.length > 0) return STATES.IN_APPROVAL;
    if (pendingClearances.length > 0) return STATES.CLEARANCE_PENDING;
    if (pendingFnf.length > 0) return STATES.FNF_PENDING;
    return STATES.COMPLETED;
  }

  if (currentStatus === STATES.CLEARANCE_PENDING) {
    if (pendingClearances.length > 0) return STATES.CLEARANCE_PENDING;
    if (pendingFnf.length > 0) return STATES.FNF_PENDING;
    return STATES.COMPLETED;
  }

  if (currentStatus === STATES.FNF_PENDING) {
    if (pendingFnf.length > 0) return STATES.FNF_PENDING;
    return STATES.COMPLETED;
  }

  return currentStatus;
}

module.exports = {
  STATES,
  validateTransition,
  determineNextWorkflowStatus
};
