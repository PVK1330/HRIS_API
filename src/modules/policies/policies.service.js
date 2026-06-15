'use strict';

const repo = require('./policies.repository');
const employeePolicies = require('./policies.employee');
const workflowAudit = require('../workflow/workflowAudit.service');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

/**
 * Actor fields for the shared workflow_audit_logs writer. actor_employee_id has
 * an FK to employees(id), so we prefer the resolved employee id (or null) — never
 * a raw admin id that might not be an employee — exactly like the assets module.
 */
function auditActor(user) {
  return {
    actorEmployeeId: user?.employeeId || user?.id || null,
    actorName: user?.name || user?.full_name || user?.fullName || user?.email || null,
  };
}

async function listPolicies(tenant, filters) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool, filters);
}

async function getPolicy(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const policy = await repo.findById(pool, id);
  if (!policy) throw new ApiError(404, 'Policy not found');
  return policy;
}

async function createPolicy(tenant, user, data) {
  const pool = await getTenantPool(tenant.dbName);
  const payload = {
    ...data,
    createdBy: user.id
  };
  const policy = await repo.create(pool, payload);

  // P1: creating a policy already in 'Published' state notifies its audience.
  if (String(policy.status) === 'Published') {
    await employeePolicies.notifyAudienceToAcknowledge(tenant, pool, policy).catch(() => {});
  }

  // P5: audit (best-effort).
  await workflowAudit.log(tenant, {
    module: 'policies',
    action: 'create',
    entityType: 'policy',
    entityId: policy.id,
    ...auditActor(user),
    detail: { status: policy.status, contentVersion: policy.contentVersion },
  });
  return policy;
}

async function updatePolicy(tenant, id, data, user) {
  const pool = await getTenantPool(tenant.dbName);
  const { policy, transitionedToPublished, versionBumped } = await repo.update(pool, id, data);
  if (!policy) throw new ApiError(404, 'Policy not found');

  // P1/P2: (re)notify the audience only on a real transition into Published or a
  // version bump (material change / explicit re-ack). Best-effort, post-commit.
  if (transitionedToPublished || versionBumped) {
    await employeePolicies.notifyAudienceToAcknowledge(tenant, pool, policy).catch(() => {});
  }

  // P5: audit the edit, and the version bump (= re-acknowledgement supersede) as
  // its own event so compliance can see when acks were invalidated and why.
  await workflowAudit.log(tenant, {
    module: 'policies',
    action: 'update',
    entityType: 'policy',
    entityId: policy.id,
    ...auditActor(user),
    detail: {
      status: policy.status,
      contentVersion: policy.contentVersion,
      transitionedToPublished,
      versionBumped,
    },
  });
  if (versionBumped) {
    await workflowAudit.log(tenant, {
      module: 'policies',
      action: 'version_bump',
      entityType: 'policy',
      entityId: policy.id,
      ...auditActor(user),
      detail: {
        contentVersion: policy.contentVersion,
        reason: data?.requireReacknowledgement === true ? 'requested' : 'material_change',
      },
    });
  }
  return policy;
}

async function deletePolicy(tenant, id, user) {
  const pool = await getTenantPool(tenant.dbName);
  // P6: soft delete (archive) — retains acknowledgement history.
  const archived = await repo.remove(pool, id);
  if (!archived) throw new ApiError(404, 'Policy not found');

  // P5: audit the archive (records the version that was retired).
  await workflowAudit.log(tenant, {
    module: 'policies',
    action: 'archive',
    entityType: 'policy',
    entityId: Number(id),
    ...auditActor(user),
    detail: { contentVersion: Number(archived.content_version) || null },
  });
  return true;
}

async function getCompliance(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.getAcknowledgements(pool, id);
}

/** Admin (POLICIES_MANAGE) read-only: list archived (soft-deleted) policies. */
async function listArchivedPolicies(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAllArchived(pool);
}

/** Admin read-only: an archived policy's detail (404 unless it is actually archived). */
async function getArchivedPolicy(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const policy = await repo.findById(pool, id, { includeArchived: true });
  if (!policy || !policy.archivedAt) throw new ApiError(404, 'Archived policy not found');
  return policy;
}

/**
 * Admin read-only: an archived policy's acknowledgement/tracking history. Closes
 * the soft-delete loop — retained compliance history is reachable in-product.
 */
async function getArchivedCompliance(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const policy = await repo.findById(pool, id, { includeArchived: true });
  if (!policy || !policy.archivedAt) throw new ApiError(404, 'Archived policy not found');
  return repo.getAcknowledgements(pool, id);
}

async function listMyPolicies(tenant, user) {
  const pool = await getTenantPool(tenant.dbName);
  return employeePolicies.listMyPolicies(pool, user);
}

async function getMyPolicy(tenant, user, policyId) {
  const pool = await getTenantPool(tenant.dbName);
  return employeePolicies.getMyPolicy(pool, user, policyId);
}

async function acknowledgePolicy(tenant, user, policyId) {
  const pool = await getTenantPool(tenant.dbName);
  const result = await employeePolicies.acknowledgeMyPolicy(pool, user, policyId);

  // P5: audit only a genuinely new acknowledgement (covers first ack AND re-ack of
  // a bumped version). Actor is the acknowledging employee (valid FK).
  if (!result.alreadyAcknowledged) {
    await workflowAudit.log(tenant, {
      module: 'policies',
      action: 'acknowledge',
      entityType: 'policy',
      entityId: Number(policyId),
      actorEmployeeId: employeePolicies.resolveEmployeeId(user),
      actorName: user?.name || user?.full_name || user?.fullName || user?.email || null,
      detail: { contentVersion: result.acknowledgedVersion },
    });
  }
  return result;
}

async function autoAssignForEmployee(tenant, employeeId) {
  return employeePolicies.autoAssignPoliciesForEmployee(tenant, employeeId);
}

async function listCategories(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.listCategoriesWithStats(pool);
}

async function createCategory(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.createCategory(pool, data);
}

async function updateCategory(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.updateCategory(pool, id, data);
}

async function deleteCategory(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.deleteCategory(pool, id);
}

/**
 * Bulk create policies from import (CSV or JSON).
 * Returns { success: [], failed: [] }.
 */
async function bulkCreatePolicies(tenant, user, policies) {
  const pool = await getTenantPool(tenant.dbName);
  const success = [];
  const failed = [];

  for (let i = 0; i < policies.length; i++) {
    try {
      const payload = {
        ...policies[i],
        createdBy: user.id,
      };
      const policy = await repo.create(pool, payload);

      // Notify audience if published (though imported policies start as Draft)
      if (String(policy.status) === 'Published') {
        await employeePolicies.notifyAudienceToAcknowledge(tenant, pool, policy).catch(() => {});
      }

      // Audit
      await workflowAudit.log(tenant, {
        module: 'policies',
        action: 'import',
        entityType: 'policy',
        entityId: policy.id,
        ...auditActor(user),
        detail: { status: policy.status, contentVersion: policy.contentVersion },
      });

      success.push(policy);
    } catch (err) {
      failed.push({
        index: i + 1,
        policy: policies[i],
        error: err.message,
      });
    }
  }

  return { success, failed };
}

/**
 * Get all employees who match a policy's audience configuration.
 * Used for export tracking and compliance reporting.
 */
async function getPolicyTargetEmployees(tenant, policy) {
  const pool = await getTenantPool(tenant.dbName);
  const { buildAudienceWhere } = require('./policies.audience');
  const { clause, params } = buildAudienceWhere(policy.audienceConfig || {});

  const { rows } = await pool.query(
    `
    SELECT
      e.id,
      e.full_name as "fullName",
      e.email,
      d.name as "departmentName"
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE ${clause}
    ORDER BY e.full_name
  `,
    params,
  );

  return rows;
}

module.exports = {
  listPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getCompliance,
  listArchivedPolicies,
  getArchivedPolicy,
  getArchivedCompliance,
  listMyPolicies,
  getMyPolicy,
  acknowledgePolicy,
  autoAssignForEmployee,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  bulkCreatePolicies,
  getPolicyTargetEmployees,
};
