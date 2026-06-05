'use strict';

const ApiError = require('../../utils/ApiError');
const { superAdminPool } = require('../../config/db');
const { runTenantMigrations } = require('../tenant/tenant.service');
const { getTenantPool } = require('../../config/db');

const rbacRepo = require('./rbac.repository');
const notify = require('../notifications/notifications.service');

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
  return rbacRepo.findAllPermissions(pool);
}

async function listAvailablePermissions(req) {
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const all = await rbacRepo.findAllPermissions(pool);
  return rbacRepo.filterPermissionsByTenantPlan(
    superAdminPool,
    Number(req.user.tenant_id),
    all,
  );
}

async function listRoles(req) {
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  return rbacRepo.findAllRoles(pool);
}

async function createRole(req) {
  const { name, description, scope } = req.body;
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  try {
    const role = await rbacRepo.insertRole(pool, { name, description, scope });
    notify.pushNotification({ db_name: req.user.db_name }, {
      forAdmin: true,
      title: `Role Created: ${role?.name || name}`,
      message: `A new role "${role?.name || name}" has been created.`,
      type: 'info',
      entityType: 'rbac_role',
      entityId: role?.id ?? null,
      redirectUrl: '/admin/settings/roles',
    }).catch(() => null);
    return role;
  } catch (e) {
    if (e && e.code === '23505') throw ApiError.conflict('Role name already exists');
    if (e && e.message && e.message.includes('Invalid data scope')) {
      throw ApiError.badRequest(e.message);
    }
    throw e;
  }
}

async function updateRolePermissions(req) {
  const roleId = Number(req.params.roleId);
  const { permissionIds, scope } = req.body;
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const roles = await rbacRepo.findAllRoles(pool);
  const role = roles.find((r) => r.id === roleId);
  if (!role) throw ApiError.notFound('Role not found');

  if (scope !== undefined && scope !== null) {
    const isOrgAdmin =
      role.is_system && String(role.name).trim() === 'Organization Admin';
    if (isOrgAdmin && String(scope).toUpperCase() !== 'ALL') {
      throw ApiError.badRequest('Organization Admin must use ALL data scope');
    }
    try {
      await rbacRepo.setRoleDataScope(pool, roleId, scope);
    } catch (e) {
      if (e && e.message && e.message.includes('Invalid data scope')) {
        throw ApiError.badRequest(e.message);
      }
      throw e;
    }
  }

  await rbacRepo.setRolePermissions(pool, roleId, Array.isArray(permissionIds) ? permissionIds : []);

  const tenant = { db_name: req.user.db_name };
  notify.pushNotification(tenant, {
    forAdmin: true,
    title: `Role Updated: ${role.name}`,
    message: `Permissions for the "${role.name}" role have been updated.`,
    type: 'info',
    entityType: 'rbac_role',
    entityId: roleId,
    redirectUrl: '/admin/settings/roles',
  }).catch(() => null);

  // Tell each employee holding this role that their access changed.
  try {
    const { rows: affected } = await pool.query(
      `SELECT id FROM employees WHERE rbac_role_id = $1 AND deleted_at IS NULL`,
      [roleId],
    );
    for (const emp of affected) {
      notify.pushNotification(tenant, {
        employeeId: Number(emp.id),
        title: 'Your Access Was Updated',
        message: 'Your access permissions have been updated by an administrator.',
        type: 'info',
        entityType: 'rbac_role',
        entityId: roleId,
        redirectUrl: '/employee/dashboard',
      }).catch(() => null);
    }
  } catch (_) { /* non-blocking */ }

  return rbacRepo.findAllRoles(pool).then((rs) => rs.find((r) => r.id === roleId));
}

async function getRole(req) {
  const id = Number(req.params.id);
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const role = (await rbacRepo.findAllRoles(pool)).find((r) => r.id === id);
  if (!role) throw ApiError.notFound('Role not found');
  return role;
}

async function updateRole(req) {
  const id = Number(req.params.id);
  const { name, description, scope } = req.body;
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);

  const existing = (await rbacRepo.findAllRoles(pool)).find((r) => r.id === id);
  if (!existing) throw ApiError.notFound('Role not found');
  if (existing.is_system) throw ApiError.badRequest('System roles cannot be edited');

  let updated;
  try {
    updated = await rbacRepo.updateRole(pool, id, { name, description });
  } catch (e) {
    if (e && e.code === '23505') throw ApiError.conflict('Role name already exists');
    throw e;
  }
  if (!updated) throw ApiError.notFound('Role not found');

  if (scope !== undefined && scope !== null) {
    try {
      await rbacRepo.setRoleDataScope(pool, id, scope);
    } catch (e) {
      if (e && e.message && e.message.includes('Invalid data scope')) {
        throw ApiError.badRequest(e.message);
      }
      throw e;
    }
  }

  notify.pushNotification({ db_name: req.user.db_name }, {
    forAdmin: true,
    title: `Role Updated: ${updated.name}`,
    message: `The "${updated.name}" role has been updated.`,
    type: 'info',
    entityType: 'rbac_role',
    entityId: id,
    redirectUrl: '/admin/settings/roles',
  }).catch(() => null);

  return (await rbacRepo.findAllRoles(pool)).find((r) => r.id === id);
}

async function deleteRole(req) {
  const id = Number(req.params.id);
  const pool = resolvePool(req.user.db_name);
  await ensureMigrated(req.user.db_name);
  const roles = await rbacRepo.findAllRoles(pool);
  const role = roles.find((r) => r.id === id);
  const ok = await rbacRepo.deleteRole(pool, id);
  if (!ok) throw ApiError.badRequest('Cannot delete system role or role not found');

  notify.pushNotification({ db_name: req.user.db_name }, {
    forAdmin: true,
    title: `Role Deleted: ${role?.name || 'Role'}`,
    message: `The "${role?.name || 'role'}" role has been deleted.`,
    type: 'warning',
    entityType: 'rbac_role',
    entityId: id,
    redirectUrl: '/admin/settings/roles',
  }).catch(() => null);

  return null;
}

module.exports = {
  listPermissions,
  listAvailablePermissions,
  listRoles,
  getRole,
  createRole,
  updateRole,
  updateRolePermissions,
  deleteRole,
};
