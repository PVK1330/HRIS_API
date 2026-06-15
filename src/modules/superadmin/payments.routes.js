// src/modules/superadmin/payments.routes.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const paymentsController = require('./payments.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

router.use(authenticate);
router.use(requireRole('superadmin', 'billing_admin'));

router.get('/', paymentsController.getPayments);
router.get('/stats', paymentsController.getPaymentStats);
router.get('/export', paymentsController.exportPayments);
router.get('/:id/invoice-html', paymentsController.getInvoiceHtml);
router.post(
  '/manual',
  [
    body('tenant_id').isInt({ gt: 0 }).withMessage('tenant_id must be a positive integer'),
    body('amount').isFloat({ gt: 0 }).withMessage('amount must be greater than 0'),
    body('currency').optional().isString().isLength({ min: 3, max: 3 }).withMessage('currency must be a 3-letter code'),
    body('billing_start_date').isISO8601().withMessage('billing_start_date must be a valid date'),
    body('billing_end_date').isISO8601().withMessage('billing_end_date must be a valid date'),
    body('payment_method').optional().isString().withMessage('payment_method must be a string'),
    body('notes').optional().isString().withMessage('notes must be a string'),
  ],
  validate,
  paymentsController.createManualInvoice
);
router.patch('/:id/status', paymentsController.updatePaymentStatus);

module.exports = router;
