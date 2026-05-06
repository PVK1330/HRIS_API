// src/modules/superadmin/payments.routes.js
const express = require('express');
const router = express.Router();
const paymentsController = require('./payments.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

router.use(authenticate);
router.use(requireRole('superadmin', 'billing_admin'));

router.get('/', paymentsController.getPayments);
router.get('/stats', paymentsController.getPaymentStats);
router.patch('/:id/status', paymentsController.updatePaymentStatus);

module.exports = router;
