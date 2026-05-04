// src/routes/superadmin/paymentRoutes.js
const express = require('express');
const router = express.Router();
const {
  processManualPayment,
  getAllPayments,
  getPaymentById,
  refundPayment,
  getPaymentStats,
  getTenantPayments
} = require('../../services/paymentService');

/**
 * POST /api/superadmin/payments
 * Process manual payment for tenant
 */
router.post('/', async (req, res) => {
  try {
    const superadminId = req.user?.id;
    if (!superadminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await processManualPayment(req.body, superadminId);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Payment processed successfully'
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: error.message || 'Failed to process payment' });
  }
});

/**
 * GET /api/superadmin/payments
 * Get all payments (with filters)
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      tenantId: req.query.tenantId,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    const result = await getAllPayments(filters);
    res.json({ data: result });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

/**
 * GET /api/superadmin/payments/stats
 * Get payment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    const result = await getPaymentStats(tenantId);
    res.json({ data: result });
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    res.status(500).json({ error: 'Failed to fetch payment statistics' });
  }
});

/**
 * GET /api/superadmin/payments/:paymentId
 * Get payment by ID
 */
router.get('/:paymentId', async (req, res) => {
  try {
    const result = await getPaymentById(req.params.paymentId);
    if (!result) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json({ data: result });
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

/**
 * POST /api/superadmin/payments/:paymentId/refund
 * Refund a payment
 */
router.post('/:paymentId/refund', async (req, res) => {
  try {
    const superadminId = req.user?.id;
    if (!superadminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await refundPayment(req.params.paymentId, req.body, superadminId);
    res.json({ 
      success: true,
      data: result,
      message: 'Payment refunded successfully'
    });
  } catch (error) {
    console.error('Error refunding payment:', error);
    res.status(500).json({ error: 'Failed to refund payment' });
  }
});

/**
 * GET /api/superadmin/payments/tenant/:tenantId
 * Get payments for specific tenant
 */
router.get('/tenant/:tenantId', async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    const result = await getTenantPayments(req.params.tenantId, filters);
    res.json({ data: result });
  } catch (error) {
    console.error('Error fetching tenant payments:', error);
    res.status(500).json({ error: 'Failed to fetch tenant payments' });
  }
});

module.exports = router;
