'use strict';

const { Router } = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadTenantLogo } = require('../../middlewares/upload.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./tenantSettings.controller');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

router.get('/', controller.getAdminSettings);
router.put('/', controller.updateAdminSettings);
router.post('/logo', uploadTenantLogo.single('logo'), controller.uploadLogo);

module.exports = router;
