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

async function listDesignations(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(2000, parseInt(query.limit, 10) || 20);
  const search = (query.search || '').trim();
  let status = (query.status || 'all').toString().toLowerCase();
  if (!['all', 'active', 'inactive'].includes(status)) status = 'all';
  const departmentId = query.departmentId ?? query.department_id ?? '';
  const departmentName = query.departmentName ?? query.department_name ?? '';

  const result = await repo.findAllPaginated(pool, {
    search,
    status,
    departmentId,
    departmentName,
    page,
    limit,
  });
  return {
    designations: result.rows,
    total: result.total,
    page: result.page,
    limit: result.limit,
    pages: result.pages,
  };
}

async function listDesignationsByDepartmentName(tenant, deptName) {
  const pool = await getTenantPool(tenant.dbName);
  const name = String(deptName || '').trim();
  if (!name) throw new ApiError(400, 'Department name is required');
  return repo.findActiveByDepartmentName(pool, name);
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
    name: data.name,
    departmentId: parseInt(String(departmentId), 10),
    isActive,
    description: data.description ?? null,
  });
}

async function updateDesignation(tenant, id, data) {
  const pool = await getTenantPool(tenant.dbName);
  const payload = {};

  if (data.name !== undefined) payload.name = data.name;

  const depRaw = data.departmentId ?? data.department_id;
  if (depRaw !== undefined) {
    payload.departmentId =
      depRaw !== null && String(depRaw).trim() !== ""
        ? parseInt(String(depRaw), 10)
        : null;
    if (payload.departmentId !== null && (!Number.isInteger(payload.departmentId) || payload.departmentId <= 0)) {
      payload.departmentId = null;
    }
  }

  const hasStatus =
    data.status !== undefined || data.isActive !== undefined || data.is_active !== undefined;
  if (hasStatus) {
    const isActive = normalizeIsActiveFromPayload(data, false);
    if (isActive === undefined) throw new ApiError(400, "Status must be Active or Inactive");
    payload.isActive = isActive;
  }

  if (data.description !== undefined) payload.description = data.description;

  const updated = await repo.update(pool, id, payload);
  if (!updated) throw new ApiError(404, "Designation not found");
  return updated;
}

async function deleteDesignation(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.softDeactivate(pool, id);
  if (!deleted) throw new ApiError(404, 'Designation not found');
  return true;
}

module.exports = {
  listDesignations,
  listDesignationsByDepartmentName,
  getDesignation,
  createDesignation,
  updateDesignation,
  deleteDesignation,
};
