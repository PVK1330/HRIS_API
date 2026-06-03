'use strict';

const { Router } = require('express');

const { authenticate, requirePermission, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./sensitiveData.controller');
const { mergeSensitiveBody } = require('./sensitiveData.service');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext, requirePermission('system-settings'));

function normalizeBody(req, _res, next) {
  req.body = mergeSensitiveBody(req.body || {});
  next();
}

router.get('/', controller.getSensitiveDataSettings);
router.put('/', normalizeBody, controller.updateSensitiveDataSettings);

module.exports = router;
