'use strict';

const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ApiError = require('../../utils/ApiError');
const ctrl = require('./rbac.controller');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(ApiError.forbidden('Only organization admins can manage roles'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

router.get('/permissions', ctrl.listPermissions);
router.get('/permissions/available', ctrl.listAvailablePermissions);

router.get('/roles', ctrl.listRoles);

router.post('/roles', ctrl.createRole);

router.put('/roles/:roleId/permissions', ctrl.updateRolePermissions);

router.delete('/roles/:id', ctrl.deleteRole);

module.exports = router;
