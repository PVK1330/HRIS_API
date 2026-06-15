'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./tenantBilling.controller');

const router = Router();

// Tenant-facing self-service billing (any authenticated tenant user can read status).
router.get('/status', authenticate, controller.getStatus);
router.get('/plans', authenticate, controller.getPlans);
router.get('/gateways', authenticate, controller.getGateways);
router.post('/checkout', authenticate, controller.checkout);
router.post('/confirm', authenticate, controller.confirm);
router.post('/paypal/checkout', authenticate, controller.paypalCheckout);
router.post('/paypal/confirm', authenticate, controller.paypalConfirm);

// Superadmin offline/manual activation ("mark as paid").
router.post('/:tenantId/activate', authenticate, requireRole('superadmin', 'billing_admin'), controller.activate);

module.exports = router;
