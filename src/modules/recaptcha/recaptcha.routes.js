'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./recaptcha.controller');
const { MASKED } = require('./recaptcha.service');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

/**
 * Conditional length check: when isEnabled is true, the keys are required
 * and must be at least 30 chars. When disabled, empty values are allowed
 * (operator may temporarily turn off without filling everything in).
 */
const updateValidators = [
  body('isEnabled').optional().isBoolean().toBoolean(),
  body('siteKey').optional().isString().trim()
    .if(body('isEnabled').custom((v) => v === true || v === 'true'))
    .isLength({ min: 30 }).withMessage('siteKey must be at least 30 chars'),
  body('secretKey').optional().isString()
    .custom((value, { req }) => {
      // Skip when masked (means "keep existing").
      if (value === MASKED) return true;
      if (req.body.isEnabled === true || req.body.isEnabled === 'true') {
        if (typeof value !== 'string' || value.trim().length < 30) {
          throw new Error('secretKey must be at least 30 chars when reCAPTCHA is enabled');
        }
      }
      return true;
    }),
];

router.get('/', controller.get);
router.put('/', updateValidators, validate, controller.update);
router.post('/test', controller.test);

module.exports = router;
