'use strict';

const repo = require('./policies.repository');
const tenantSettingsRepo = require('../tenantSettings/tenantSettings.repository');
const { pushNotification } = require('../notifications/notifications.service');
const ApiError = require('../../utils/ApiError');

function resolveEmployeeId(user) {
  if (!user) return null;
  if (user.role === 'employee') return user.id;
  return user.employeeId || user.id;
}

async function listMyPolicies(pool, user) {
  const employeeId = resolveEmployeeId(user);
  if (!employeeId) throw new ApiError(400, 'Employee context required');

  const { policies } = await repo.findPublishedForEmployee(pool, employeeId);
  return policies;
}

async function getMyPolicy(pool, user, policyId) {
  const employeeId = resolveEmployeeId(user);
  if (!employeeId) throw new ApiError(400, 'Employee context required');

  const policy = await repo.findPublishedByIdForEmployee(pool, policyId, employeeId);
  if (!policy) throw new ApiError(404, 'Policy not found or not available to you');
  return policy;
}

async function acknowledgeMyPolicy(pool, user, policyId) {
  const employeeId = resolveEmployeeId(user);
  if (!employeeId) throw new ApiError(400, 'Employee context required');

  const policy = await repo.findPublishedByIdForEmployee(pool, policyId, employeeId);
  if (!policy) throw new ApiError(404, 'Policy not found or not available to you');
  if (policy.ackStatus === 'Not Applicable') {
    throw new ApiError(400, 'Acknowledgement is not required for this policy');
  }
  if (!policy.ackRequired) {
    throw new ApiError(400, 'This policy does not require acknowledgement');
  }
  if (policy.ackStatus === 'Acknowledged') {
    return { alreadyAcknowledged: true, acknowledgedAt: policy.acknowledgedAt };
  }

  const ack = await repo.acknowledge(pool, policyId, employeeId);
  return { alreadyAcknowledged: false, acknowledgedAt: ack.acknowledged_at };
}

/**
 * When tenant setting auto_assign_policies is enabled, notify the employee
 * about each published policy they must acknowledge.
 */
async function autoAssignPoliciesForEmployee(tenant, employeeId) {
  if (!tenant?.dbName || !employeeId) return { notified: 0 };

  const { getTenantPool } = require('../../config/db');
  const pool = await getTenantPool(tenant.dbName);

  const settings = await tenantSettingsRepo.getSettings(pool);
  if (!settings?.auto_assign_policies) return { notified: 0 };

  const { policies } = await repo.findPublishedForEmployee(pool, employeeId);
  const pending = policies.filter((p) => p.ackStatus === 'Pending');

  let notified = 0;
  for (const p of pending) {
    try {
      await pushNotification(tenant, {
        employeeId,
        forAdmin: false,
        title: 'Policy acknowledgement required',
        message: `Please review and acknowledge: ${p.title}`,
        type: 'policy',
      });
      notified += 1;
    } catch {
      /* non-blocking */
    }
  }

  return { notified };
}

module.exports = {
  resolveEmployeeId,
  listMyPolicies,
  getMyPolicy,
  acknowledgeMyPolicy,
  autoAssignPoliciesForEmployee,
};
