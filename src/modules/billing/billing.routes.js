'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const ctrl = require('./billing.controller');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

router.post(
  '/stripe/checkout-session',
  [
    body('tenantId').isInt({ min: 1 }).withMessage('tenantId is required'),
    body('planId').isInt({ min: 1 }).withMessage('planId is required'),
    body('paymentId').optional({ nullable: true }).isInt({ min: 1 }),
    body('billingCycle').optional().isIn(['monthly', 'annual', 'Monthly', 'Annual']),
    body('customerEmail').optional().isEmail().normalizeEmail(),
  ],
  validate,
  ctrl.createStripeCheckout,
);

module.exports = router;
