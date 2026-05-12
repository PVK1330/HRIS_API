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

async function listDepartments(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(2000, parseInt(query.limit, 10) || 20);
  const search = (query.search || '').trim();
  let status = (query.status || 'all').toString().toLowerCase();
  if (!['all', 'active', 'inactive'].includes(status)) status = 'all';

  const result = await repo.findAllPaginated(pool, { search, status, page, limit });
  return {
    departments: result.rows,
    total: result.total,
    page: result.page,
    limit: result.limit,
    pages: result.pages,
  };
}

async function listDepartmentManagers(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, full_name AS name, emp_id
     FROM employees
     WHERE deleted_at IS NULL
     ORDER BY full_name ASC
     LIMIT 500`,
  );
  return rows;
}

async function getDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const dept = await repo.findById(pool, id);
  if (!dept) throw new ApiError(404, 'Department not found');
  return dept;
}

async function createDepartment(tenant, data) {
  const pool = await getTenantPool(tenant.dbName);
  const isActive = normalizeIsActiveFromPayload(data, true);
  const managerRaw = data.managerId ?? data.manager_id;
  const managerId =
    managerRaw !== undefined && managerRaw !== null && String(managerRaw).trim() !== ''
      ? parseInt(String(managerRaw), 10)
      : null;
  const payload = {
    name: data.name,
    code: data.code || buildDepartmentCode(data.name),
    description: data.description ?? null,
    isActive,
    managerId: Number.isInteger(managerId) && managerId > 0 ? managerId : null,
  };
  return repo.create(pool, payload);
}

async function updateDepartment(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const payload = {};

  if (data.name !== undefined) payload.name = data.name;
  if (data.code !== undefined) payload.code = data.code;
  if (data.description !== undefined) payload.description = data.description;

  const hasStatus =
    data.status !== undefined || data.isActive !== undefined || data.is_active !== undefined;
  if (hasStatus) {
    const isActive = normalizeIsActiveFromPayload(data, false);
    if (isActive === undefined) throw new ApiError(400, 'Status must be Active or Inactive');
    payload.isActive = isActive;
  }

  const managerRaw = data.managerId ?? data.manager_id;
  if (managerRaw !== undefined) {
    payload.managerId =
      managerRaw !== null && String(managerRaw).trim() !== ""
        ? parseInt(String(managerRaw), 10)
        : null;
    if (payload.managerId !== null && (!Number.isInteger(payload.managerId) || payload.managerId <= 0)) {
      payload.managerId = null;
    }
  }

  const updated = await repo.update(pool, id, payload);
  if (!updated) throw new ApiError(404, 'Department not found');
  return updated;
}

async function deleteDepartment(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const ok = await repo.softDeactivate(pool, id);
  if (!ok) throw new ApiError(404, 'Department not found');
  return true;
}

module.exports = {
  listDepartments,
  listDepartmentManagers,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
