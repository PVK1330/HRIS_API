'use strict';

const repo = require('./designations.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

function normalizeIsActiveFromPayload(data, requireStatus = false) {
  const candidate = data.status ?? data.isActive ?? data.is_active;
  if (candidate === undefined || candidate === null || candidate === '') {
    if (requireStatus) throw new ApiError(400, 'Status is required');
    return undefined;
  }

  if (typeof candidate === 'boolean') return candidate;

  const normalized = String(candidate).toLowerCase();
  if (normalized === 'active' || normalized === 'true') return true;
  if (normalized === 'inactive' || normalized === 'false') return false;
  throw new ApiError(400, 'Status must be Active or Inactive');
}

async function listDesignations(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool);
}

async function getDesignation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const designation = await repo.findById(pool, id);
  if (!designation) throw new ApiError(404, 'Designation not found');
  return designation;
}

async function createDesignation(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = normalizeIsActiveFromPayload(data, true);
  const departmentId = data.departmentId ?? data.department_id;
  if (!departmentId) throw new ApiError(400, 'Department is required');
  return repo.create(pool, {
    ...data,
    departmentId,
    isActive,
  });
}

async function updateDesignation(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = normalizeIsActiveFromPayload(data, false);
  const payload = {
    ...data,
    ...(data.department_id !== undefined ? { departmentId: data.department_id } : {}),
    ...(isActive === undefined ? {} : { isActive }),
  };
  const updated = await repo.update(pool, id, payload);
  if (!updated) throw new ApiError(404, 'Designation not found');
  return updated;
}

async function deleteDesignation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Designation not found');
  return true;
}

module.exports = {
  listDesignations,
  getDesignation,
  createDesignation,
  updateDesignation,
  deleteDesignation,
};
