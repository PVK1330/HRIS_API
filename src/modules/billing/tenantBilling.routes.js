'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./tenantBilling.controller');

const router = Router();

// Tenant-facing self-service billing (any authenticated tenant user can read status).
router.get('/status', authenticate, controller.getStatus);
router.get('/plans', authenticate, controller.getPlans);
router.post('/checkout', authenticate, controller.checkout);
router.post('/confirm', authenticate, controller.confirm);

// Superadmin offline/manual activation ("mark as paid").
router.post('/:tenantId/activate', authenticate, requireRole('superadmin', 'billing_admin'), controller.activate);

module.exports = router;
