'use strict';

const { Router } = require('express');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./sensitiveData.controller');
const { mergeSensitiveBody } = require('./sensitiveData.service');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

function normalizeBody(req, _res, next) {
  req.body = mergeSensitiveBody(req.body || {});
  next();
}

router.get('/', controller.getSensitiveDataSettings);
router.put('/', normalizeBody, controller.updateSensitiveDataSettings);

module.exports = router;
