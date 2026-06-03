'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const { authenticate, requirePermission, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./passwordSecurity.controller');
const {
  VALID_RECOVERY_OPTIONS,
  mergePasswordSecurityFlat,
} = require('./passwordSecurity.service');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext, requirePermission('system-settings'));

function normalizeBody(req, _res, next) {
  req.body = { ...(req.body || {}), ...mergePasswordSecurityFlat(req.body || {}) };
  next();
}

const putValidators = [
  body('minimum_length').optional().isInt({ min: 6, max: 32 }),
  body('password_expiry_days').optional().isInt({ min: 1, max: 365 }),
  body('auto_logout_minutes').optional().isInt({ min: 5, max: 480 }),
  body('max_login_attempt_limit').optional().isInt({ min: 1, max: 20 }),
  body('blocked_account_recovery').optional().isIn(VALID_RECOVERY_OPTIONS),
  body('must_include_special_chars').optional().isBoolean(),
  body('two_factor_auth').optional().isBoolean(),
];

router.get('/', controller.getPasswordSecuritySettings);
router.put('/', normalizeBody, putValidators, validate, controller.updatePasswordSecuritySettings);

module.exports = router;
