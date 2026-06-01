'use strict';

/**
 * Exit Management authorization middleware (replaces requirePermission(P.EXIT_MANAGE)).
 *
 * Chain (spec §11):
 *   authenticate -> tenantResolver -> loadUserContext -> loadWorkflowContext
 *                -> resolveExitAccess -> authorizeExitAccess({action})
 *
 * loadAuthContext (scope engine) is intentionally NOT in this chain — exit access is
 * resolved purely from workflow stage ownership, never from SELF/TEAM/DEPARTMENT scope.
 */

const ApiError = require('../../utils/ApiError');
const { getTenantPool } = require('../../config/db');
const { P, expandPermissionKeys, permissionSatisfied } = require('../../constants/permissions');
const resolver = require('./exitAccessResolver.service');

/* ------------------------------------------------------------------ */
/*  1. loadUserContext — builds req.exitUser                          */
/* ------------------------------------------------------------------ */

async function loadUserContext(req, _res, next) {
  try {
    const { user } = req;
    if (!user) return next(ApiError.unauthorized('Authentication required'));

    const dbName = req.tenant?.dbName || user.db_name;
    if (!dbName) return next(ApiError.badRequest('Tenant context is required'));
    const pool = getTenantPool(dbName);

    const employeeId = user.employeeId || null;
    const rbacRoleId = user.rbacRoleId || null;

    // Resolve the canonical department_id from the employees table — never trust the JWT string.
    let departmentId = null;
    if (employeeId) {
      const { rows } = await pool.query(
        'SELECT department_id FROM employees WHERE id = $1',
        [employeeId],
      );
      departmentId = rows[0]?.department_id ?? null;
    }

    // Org-wide exit admin = TENANT ADMIN / SUPERADMIN role only.
    // NOTE: this is intentionally role-based, NOT permission-based. The legacy
    // 'exit-management' module permission expands to exit.manage, so keying org-admin
    // off the permission would make every role that can merely SEE the exit module a
    // global override of stage ownership. Module visibility (exit-management permission)
    // is therefore decoupled from org-admin: portal staff act ONLY via stage ownership;
    // only the tenant Org Admin gets the read-all + mutate-any override.
    const isOrgExitAdmin = user.role === 'admin' || user.role === 'superadmin';

    // Workflow-CONFIG capability is broader than the stage-override admin: the tenant Org Admin
    // OR anyone who manages settings (holds 'system-settings', e.g. HR Admin) may configure
    // exit workflows. This is separate from isOrgExitAdmin (which governs stage-ownership override).
    let canConfigureExit = isOrgExitAdmin;
    if (!canConfigureExit && rbacRoleId) {
      try {
        const rbacRepo = require('../rbac/rbac.repository');
        const keys = await rbacRepo.permissionKeysForRole(pool, rbacRoleId);
        const expanded = expandPermissionKeys(keys);
        canConfigureExit = permissionSatisfied(expanded, 'system-settings')
          || permissionSatisfied(expanded, P.EXIT_MANAGE) && permissionSatisfied(expanded, 'departments.manage');
      } catch (_) {
        canConfigureExit = false; // fail-closed
      }
    }

    req.exitUser = {
      userId: user.id,
      employeeId,
      departmentId,
      rbacRoleId,
      isOrgExitAdmin,
      canConfigureExit,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ */
/*  2. loadWorkflowContext — builds req.exitWorkflow (for :id routes) */
/* ------------------------------------------------------------------ */

async function loadWorkflowContext(req, _res, next) {
  try {
    const dbName = req.tenant?.dbName || req.user?.db_name;
    const pool = getTenantPool(dbName);
    const exitRequestId = Number(req.params.id);
    if (!Number.isInteger(exitRequestId) || exitRequestId <= 0) {
      return next(ApiError.badRequest('Invalid exit request id'));
    }
    const wfCtx = await resolver.loadWorkflowContext(pool, exitRequestId);
    if (!wfCtx) return next(ApiError.notFound('Exit request not found'));
    req.exitWorkflow = wfCtx;
    return next();
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ */
/*  3. resolveExitAccess — builds req.exitAccess + req.exitActions    */
/* ------------------------------------------------------------------ */

async function resolveExitAccess(req, _res, next) {
  try {
    const dbName = req.tenant?.dbName || req.user?.db_name;
    const pool = getTenantPool(dbName);
    const accessCtx = await resolver.resolveExitAccess(pool, req.exitUser, req.exitWorkflow);
    req.exitAccess = accessCtx;
    req.exitActions = resolver.permittedActionsFor(accessCtx);
    return next();
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ */
/*  4. authorizeExitAccess({ action }) — the spec §10 single guard    */
/* ------------------------------------------------------------------ */

function authorizeExitAccess({ action } = {}) {
  return function exitAccessGuard(req, _res, next) {
    if (!req.exitUser) return next(ApiError.unauthorized('Authentication required'));

    // Workflow configuration routes — admins or settings managers (system-settings).
    if (action === 'config') {
      if (!req.exitUser.canConfigureExit) {
        return next(ApiError.forbidden('Exit workflow configuration requires administrator or settings-manager access'));
      }
      return next();
    }

    // Creating a new exit request — any authenticated portal employee.
    if (action === 'create') {
      if (!req.exitUser.employeeId) {
        return next(ApiError.forbidden('A linked employee profile is required to submit an exit request'));
      }
      return next();
    }

    // Per-request verbs (view + stage-ownership actions): require the resolved action set.
    if (!req.exitActions || !req.exitActions.has(action)) {
      return next(ApiError.forbidden(`You are not allowed to "${action}" this exit request`));
    }
    return next();
  };
}

module.exports = {
  loadUserContext,
  loadWorkflowContext,
  resolveExitAccess,
  authorizeExitAccess,
};
