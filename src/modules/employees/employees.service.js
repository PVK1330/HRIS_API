'use strict';

const { getTenantPool } = require('../../config/db');
const env = require('../../config/env');

const bcrypt = require('bcrypt');

const ApiError = require('../../utils/ApiError');
const { runTenantMigrations } = require('../tenant/tenant.service');
const repo = require('./employees.repository');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _migrationCache.set(dbName, p);
  return p;
}

function resolvePool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant database not found in token');
  return getTenantPool(user.db_name);
}

// ─── List ─────────────────────────────────────────────────────────────────────

async function listEmployees(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const page   = Math.max(1, parseInt(query.page,  10) || 1);
  const limit  = Math.min(100, parseInt(query.limit, 10) || 20);
  const offset = (page - 1) * limit;

  const filters = {
    search:       query.search       || '',
    department:   query.department   || '',
    status:       query.status       || '',
    workMode:     query.workMode     || '',
    jobTitle:     query.jobTitle     || '',
    workLocation: query.workLocation || '',
    limit,
    offset,
  };

  const [employees, total] = await Promise.all([
    repo.findAll(pool, filters),
    repo.countAll(pool, filters),
  ]);

  return { employees, total, page, limit, pages: Math.ceil(total / limit) };
}

// ─── Single ───────────────────────────────────────────────────────────────────

async function getEmployee(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await repo.findById(pool, id);
  if (!emp) throw ApiError.notFound('Employee not found');
  return emp;
}

// ─── Create ───────────────────────────────────────────────────────────────────

async function createEmployee(user, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  // Uniqueness checks
  if (await repo.findByEmpId(pool, data.empId)) {
    throw ApiError.conflict(`Employee ID "${data.empId}" already exists`);
  }
  if (data.workEmail && await repo.findByWorkEmail(pool, data.workEmail)) {
    throw ApiError.conflict(`Work email "${data.workEmail}" already in use`);
  }

  // Resolve manager ID from emp_id string if provided
  if (data.reportingManagerEmpId) {
    const mgr = await repo.findByEmpId(pool, data.reportingManagerEmpId);
    data.reportingManagerId = mgr ? mgr.id : null;
  }

  const payload = { ...data };
  payload.portalEnabled = Boolean(data.portalEnabled);
  payload.rbacRoleId =
    data.rbacRoleId != null && `${data.rbacRoleId}`.trim() !== ''
      ? parseInt(String(data.rbacRoleId), 10)
      : null;
  if (!Number.isInteger(payload.rbacRoleId) || payload.rbacRoleId <= 0) {
    payload.rbacRoleId = null;
  }

  if (data.portalPassword && String(data.portalPassword).trim()) {
    payload.passwordHash = await bcrypt.hash(
      String(data.portalPassword),
      env.BCRYPT_SALT_ROUNDS
    );
    delete payload.portalPassword;
  } else if (payload.portalEnabled === false) {
    payload.passwordHash = null;
  }

  delete payload.portalPassword;

  return repo.insert(pool, { ...payload, createdBy: user.id });
}

// ─── Update ───────────────────────────────────────────────────────────────────

async function updateEmployee(user, id, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const existing = await repo.findById(pool, id);
  if (!existing) throw ApiError.notFound('Employee not found');

  // Uniqueness check on work email if changing
  if (data.workEmail && data.workEmail !== existing.work_email) {
    if (await repo.findByWorkEmail(pool, data.workEmail, id)) {
      throw ApiError.conflict(`Work email "${data.workEmail}" already in use`);
    }
  }

  // Resolve manager
  if (data.reportingManagerEmpId) {
    const mgr = await repo.findByEmpId(pool, data.reportingManagerEmpId);
    data.reportingManagerId = mgr ? mgr.id : null;
  }

  const patch = { ...data };

  if (Object.prototype.hasOwnProperty.call(data, 'portalEnabled')) {
    patch.portalEnabled = Boolean(data.portalEnabled);
    if (!patch.portalEnabled) {
      patch.passwordHash = null;
    }
  }

  if (data.rbacRoleId !== undefined) {
    patch.rbacRoleId =
      data.rbacRoleId != null && `${data.rbacRoleId}`.trim() !== ''
        ? parseInt(String(data.rbacRoleId), 10)
        : null;
    if (!Number.isInteger(patch.rbacRoleId) || patch.rbacRoleId <= 0) {
      patch.rbacRoleId = null;
    }
  }

  if (data.portalPassword && String(data.portalPassword).trim()) {
    patch.passwordHash = await bcrypt.hash(
      String(data.portalPassword),
      env.BCRYPT_SALT_ROUNDS
    );
  }
  delete patch.portalPassword;

  const updated = await repo.update(pool, id, { ...patch, updatedBy: user.id });
  if (!updated) throw ApiError.notFound('Employee not found');
  return updated;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteEmployee(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findById(pool, id);
  if (!existing) throw ApiError.notFound('Employee not found');
  const deleted = await repo.softDelete(pool, id);
  if (!deleted) throw ApiError.notFound('Employee not found');
}

// ─── Filter options + stats ───────────────────────────────────────────────────

async function getFilterOptions(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.getFilterOptions(pool);
}

async function getStats(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.getStats(pool);
}

module.exports = {
  listEmployees, getEmployee, createEmployee,
  updateEmployee, deleteEmployee, getFilterOptions, getStats,
};
