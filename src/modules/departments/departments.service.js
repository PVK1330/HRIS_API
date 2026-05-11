'use strict';

const repo = require('./departments.repository');
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

function buildDepartmentCode(name) {
  const prefix = String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
  const suffix = Date.now().toString().slice(-4);
  return `${prefix || 'DEP'}${suffix}`.slice(0, 20);
}

/**
 * List all departments for the tenant
 */
async function listDepartments(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool);
}

async function listDepartmentManagers(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findManagerOptions(pool);
}

/**
 * Get a single department
 */
async function getDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const dept = await repo.findById(pool, id);
  if (!dept) throw new ApiError(404, 'Department not found');
  return dept;
}

/**
 * Create a department
 */
async function createDepartment(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = normalizeIsActiveFromPayload(data, true);
  const payload = {
    ...data,
    code: data.code || buildDepartmentCode(data.name),
    isActive
  };
  return repo.create(pool, payload);
}

/**
 * Update a department
 */
async function updateDepartment(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = normalizeIsActiveFromPayload(data, false);
  const payload = {
    ...data,
    ...(isActive === undefined ? {} : { isActive })
  };
  const updated = await repo.update(pool, id, payload);
  if (!updated) throw new ApiError(404, 'Department not found');
  return updated;
}

/**
 * Delete a department
 */
async function deleteDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Department not found');
  return true;
}

module.exports = {
  listDepartments,
  listDepartmentManagers,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment
};
