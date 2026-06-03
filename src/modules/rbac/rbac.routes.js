'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { requireOrgSettingsAccess } = require('../../middlewares/orgSettingsAccess.middleware');
const ctrl = require('./rbac.controller');

const router = Router();

/** Tenant admin or RBAC holders with system-settings (e.g. HR Admin). */
router.use(authenticate, tenantResolver, loadAuthContext, requireOrgSettingsAccess);

router.get('/permissions', ctrl.listPermissions);
router.get('/permissions/available', ctrl.listAvailablePermissions);

router.get('/roles', ctrl.listRoles);

router.post('/roles', ctrl.createRole);

router.put('/roles/:roleId/permissions', ctrl.updateRolePermissions);

router.delete('/roles/:id', ctrl.deleteRole);

module.exports = router;
