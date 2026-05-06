'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./freeTrial.controller');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

const updateValidators = [
  body('trialEnabled').optional().isBoolean().toBoolean(),
  body('mandatoryPaymentMethod').optional().isBoolean().toBoolean(),
  body('trialDays').optional()
    .customSanitizer((v) => (v === '' || v === null ? undefined : v))
    .isInt({ min: 1, max: 365 })
    .withMessage('trialDays must be 1-365')
    .toInt(),
  body('maxTenantsPerIdentity').optional()
    .customSanitizer((v) => (v === '' || v === null ? undefined : v))
    .isInt({ min: 1, max: 10 })
    .withMessage('maxTenantsPerIdentity must be 1-10')
    .toInt(),
];

router.get('/', controller.get);
router.put('/', updateValidators, validate, controller.update);

module.exports = router;
