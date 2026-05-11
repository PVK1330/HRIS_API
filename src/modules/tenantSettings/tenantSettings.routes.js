'use strict';

const { Router } = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadTenantLogo } = require('../../middlewares/upload.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./tenantSettings.controller');

const router = Router();

router.use(authenticate, tenantResolver);

function requireTenantContext(req, _res, next) {
  if (!req.tenant?.dbName) {
    return next(new ApiError(401, 'Tenant context missing'));
  }
  next();
}

router.use(requireTenantContext);

const rbacRoutes = require('../rbac/rbac.routes');

router.use('/rbac', rbacRoutes);

const TENANT_LOGO_VIEW_ROLES = new Set([
  'admin',
  'hr_admin',
  'hr_executive',
  'manager',
  'employee',
]);

const tenantStaffMayViewLogo = (req, res, next) => {
  if (!TENANT_LOGO_VIEW_ROLES.has(req.user.role)) {
    return next(new ApiError(403, 'Access denied.'));
  }
  next();
};

router.get('/logo', tenantStaffMayViewLogo, controller.getLogo);

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(adminOnly);

router.get('/', controller.getAdminSettings);
router.put('/', controller.updateAdminSettings);
router.post('/logo', uploadTenantLogo.single('logo'), controller.uploadLogo);

module.exports = router;
