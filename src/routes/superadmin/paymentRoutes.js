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
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');

// Apply mandatory SuperAdmin authentication to all payment routes
router.use(authenticate, requireRole('superadmin'));

/**
 * POST /api/superadmin/payments
 * Process manual payment for tenant
 */
router.post('/', asyncHandler(async (req, res) => {
  const result = await processManualPayment(req.body, req.user.id);
  return ApiResponse.created(res, result, 'Payment processed successfully');
}));

/**
 * GET /api/superadmin/payments
 * Get all payments (with filters)
 */
router.get('/', asyncHandler(async (req, res) => {
  const filters = {
    tenantId: req.query.tenantId,
    status: req.query.status,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  };
  const result = await getAllPayments(filters);
  return ApiResponse.ok(res, result);
}));

/**
 * GET /api/superadmin/payments/stats
 * Get payment statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const tenantId = req.query.tenantId;
  const result = await getPaymentStats(tenantId);
  return ApiResponse.ok(res, result);
}));

/**
 * GET /api/superadmin/payments/:paymentId
 * Get payment by ID
 */
router.get('/:paymentId', asyncHandler(async (req, res) => {
  const result = await getPaymentById(req.params.paymentId);
  if (!result) {
    throw ApiError.notFound('Payment not found');
  }
  return ApiResponse.ok(res, result);
}));

/**
 * POST /api/superadmin/payments/:paymentId/refund
 * Refund a payment
 */
router.post('/:paymentId/refund', asyncHandler(async (req, res) => {
  const result = await refundPayment(req.params.paymentId, req.body, req.user.id);
  return ApiResponse.ok(res, result, 'Payment refunded successfully');
}));

/**
 * GET /api/superadmin/payments/tenant/:tenantId
 * Get payments for specific tenant
 */
router.get('/tenant/:tenantId', asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  };
  const result = await getTenantPayments(req.params.tenantId, filters);
  return ApiResponse.ok(res, result);
}));

module.exports = router;
