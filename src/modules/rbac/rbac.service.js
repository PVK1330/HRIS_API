'use strict';

const ApiError = require('../../utils/ApiError');
const { superAdminPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { getTenantPool } = require('../../config/db');

const rbacRepo = require('./rbac.repository');

function resolvePool(dbName) {
  if (!dbName) throw ApiError.unauthorized('Tenant database not found');
  return getTenantPool(dbName);
}

async function ensureMigrated(dbName) {
  return runTenantMigrations(dbName);
}

async function listPermissions(req) {
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const all = await rbacRepo.findAllPermissions(pool);
  const payload = rbacRepo.filterPermissionsByTenantPlan(
    superAdminPool,
    Number(req.user.tenant_id),
    all,
  );
  return payload;
}

async function listRoles(req) {
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  return rbacRepo.findAllRoles(pool);
}

async function createRole(req) {
  const { name, description } = req.body;
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  try {
    return await rbacRepo.insertRole(pool, { name, description });
  } catch (e) {
    if (e && e.code === '23505') throw ApiError.conflict('Role name already exists');
    throw e;
  }
}

async function updateRolePermissions(req) {
  const roleId = Number(req.params.roleId);
  const { permissionIds } = req.body;
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const roles = await rbacRepo.findAllRoles(pool);
  const role = roles.find((r) => r.id === roleId);
  if (!role) throw ApiError.notFound('Role not found');
  await rbacRepo.setRolePermissions(pool, roleId, Array.isArray(permissionIds) ? permissionIds : []);
  return rbacRepo.findAllRoles(pool).then((rs) => rs.find((r) => r.id === roleId));
}

async function deleteRole(req) {
  const id = Number(req.params.id);
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const ok = await rbacRepo.deleteRole(pool, id);
  if (!ok) throw ApiError.badRequest('Cannot delete system role or role not found');
  return null;
}

module.exports = {
  listPermissions,
  listRoles,
  createRole,
  updateRolePermissions,
  deleteRole,
};
