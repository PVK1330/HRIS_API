'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./accountSettings.controller');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

const updateValidators = [
  body('publicRegistration')
    .isBoolean()
    .withMessage('publicRegistration must be boolean')
    .toBoolean(),
  body('emailVerification').isBoolean().withMessage('emailVerification must be boolean').toBoolean(),
  body('twoFactorAuth').isBoolean().withMessage('twoFactorAuth must be boolean').toBoolean(),
];

router.get('/', controller.getAccountSettings);

router.put('/', updateValidators, validate, controller.updateAccountSettings);

module.exports = router;
