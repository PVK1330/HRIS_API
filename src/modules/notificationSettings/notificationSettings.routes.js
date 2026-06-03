'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const { authenticate, requirePermission, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./notificationSettings.controller');
const { EVENT_KEY_LIST, mergeNotificationFlat } = require('./notificationSettings.service');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext, requirePermission('system-settings'));

function normalizePutBody(req, _res, next) {
  req.body = { ...(req.body || {}), ...mergeNotificationFlat(req.body || {}) };
  next();
}

const putValidators = [
  body('email_notifications').optional().isBoolean(),
  body('sms_notifications').optional().isBoolean(),
  body('in_app_alerts').optional().isBoolean(),
];

const patchEventValidators = [
  param('eventKey').isIn(EVENT_KEY_LIST),
  body('email').optional().isBoolean(),
  body('sms').optional().isBoolean(),
  body('in_app').optional().isBoolean(),
];

router.get('/', controller.getNotificationSettings);
router.put('/', normalizePutBody, putValidators, validate, controller.updateNotificationSettings);
router.patch('/events/:eventKey', patchEventValidators, validate, controller.updateSingleEvent);

module.exports = router;
