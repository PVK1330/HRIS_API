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
    return {
      alreadyAcknowledged: true,
      acknowledgedAt: policy.acknowledgedAt,
      acknowledgedVersion: Number(policy.contentVersion || policy.content_version || 1),
    };
  }

  // Record the acknowledgement against the policy's CURRENT version so a later
  // version bump correctly flips this back to Pending (re-acknowledgement).
  const version = Number(policy.contentVersion || policy.content_version || 1);
  const ack = await repo.acknowledge(pool, policyId, employeeId, version);
  // Pending episode ends → stop the reminder clock for this (policy, employee).
  await repo.clearReminderRow(pool, policyId, employeeId).catch(() => {});
  return { alreadyAcknowledged: false, acknowledgedAt: ack.acknowledged_at, acknowledgedVersion: version };
}

/**
 * THE single "ask an employee to (re)acknowledge a policy" path, shared by
 * publish/version-bump (notifyAudienceToAcknowledge) and new-hire enrolment
 * (autoAssignPoliciesForEmployee). It (a) starts a reminder scheduling row
 * (idempotent — P3 timing clock) and (b) sends ONE 'policy' notification. Because
 * every enrolment route funnels through here, an employee is never double-notified
 * for the same event, and the reminder cron always has a first_pending_at to work
 * from.
 */
async function trackAndNotifyOne(tenant, pool, policy, employeeId) {
  await repo.ensureReminderRow(pool, policy.id, employeeId);
  await pushNotification(tenant, {
    employeeId,
    forAdmin: false,
    title: 'Policy acknowledgement required',
    message: `Please review and acknowledge: ${policy.title}`,
    type: 'policy',
    entityType: 'policy',
    entityId: policy.id,
    redirectUrl: '/admin/my-policies',
  });
}

/**
 * P1/P2: when a policy is (re)published, notify everyone in its audience who
 * still needs to acknowledge the CURRENT version (and enrol them in the reminder
 * clock). Idempotent — employees who already acknowledged the current version are
 * excluded by the repository query, so re-saving an unchanged published policy
 * notifies nobody. Best-effort (post-commit side effect); never blocks the publish.
 */
async function notifyAudienceToAcknowledge(tenant, pool, policy) {
  if (!policy || String(policy.status) !== 'Published') return { notified: 0 };
  if (policy.archivedAt || policy.archived_at) return { notified: 0 };

  const employees = await repo.findAudienceEmployeesNeedingAck(pool, policy);

  let notified = 0;
  for (const emp of employees) {
    try {
      await trackAndNotifyOne(tenant, pool, policy, emp.id);
      notified += 1;
    } catch {
      /* non-blocking */
    }
  }

  return { notified };
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

  // Funnel new hires through the SAME path as publish (enrol reminder row + notify
  // once) so reminders work for them and there is no double-notify.
  let notified = 0;
  for (const p of pending) {
    try {
      await trackAndNotifyOne(tenant, pool, p, employeeId);
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
  notifyAudienceToAcknowledge,
};
