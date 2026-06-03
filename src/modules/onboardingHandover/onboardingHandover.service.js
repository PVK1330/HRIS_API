'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repo = require('./onboardingHandover.repository');

async function listRules(tenant, { includeInactive = true } = {}) {
  const pool = await getTenantPool(tenant.dbName);
  return includeInactive ? repo.listAll(pool) : repo.listActive(pool);
}

async function createRule(tenant, body) {
  const pool = await getTenantPool(tenant.dbName);
  const departmentId = Number(body.department_id ?? body.departmentId);
  if (!Number.isInteger(departmentId) || departmentId <= 0) {
    throw ApiError.badRequest('department_id is required');
  }
  const { rows: dept } = await pool.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
  if (!dept.length) throw ApiError.notFound('Department not found');
  try {
    return await repo.create(pool, {
      departmentId,
      workflowType: body.workflow_type ?? body.workflowType ?? 'completion',
      isActive: body.is_active ?? body.isActive ?? true,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw ApiError.conflict('This department is already configured for this workflow type');
    }
    throw err;
  }
}

async function updateRule(tenant, id, body) {
  const pool = await getTenantPool(tenant.dbName);
  const updated = await repo.update(pool, id, {
    departmentId: body.department_id ?? body.departmentId,
    workflowType: body.workflow_type ?? body.workflowType,
    isActive: body.is_active ?? body.isActive,
  });
  if (!updated) throw ApiError.notFound('Handover rule not found');
  return updated;
}

async function deleteRule(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const ok = await repo.remove(pool, id);
  if (!ok) throw ApiError.notFound('Handover rule not found');
  return { deleted: true };
}

async function getHandoverRecipients(tenant, workflowType = 'completion') {
  const pool = await getTenantPool(tenant.dbName);
  return repo.resolveHandoverRecipients(pool, workflowType);
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  getHandoverRecipients,
};
