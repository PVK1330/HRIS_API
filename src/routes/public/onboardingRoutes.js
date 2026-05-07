const express = require('express');
const router = express.Router();
const { adminSelfOnboard } = require('../../services/onboardingService');
const { superAdminPool } = require('../../config/db');
const { registrationLimiter } = require('../../middlewares/rateLimit.middleware');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');

/**
 * POST /api/public/onboarding/self
 * Admin self-onboarding (creates tenant account)
 * Protected by strict rate limiting
 */
router.post('/self', registrationLimiter, asyncHandler(async (req, res) => {
  const result = await adminSelfOnboard(req.body);
  return ApiResponse.created(
    res,
    result,
    'Account created successfully. Please log in to complete setup.'
  );
}));

/**
 * GET /api/public/onboarding/subscription-plans
 * Get available subscription plans (public endpoint)
 */
router.get('/subscription-plans', asyncHandler(async (req, res) => {
  const result = await superAdminPool.query(
    `SELECT id, plan_name, plan_code, plan_description, user_quota, storage_quota_gb,
            monthly_price, annual_price, features, is_active
     FROM public.subscription_plans
     WHERE is_active = true
     ORDER BY monthly_price ASC`
  );
  return ApiResponse.ok(res, result.rows);
}));

/**
 * POST /api/public/onboarding/check-email
 * Check if email is available for registration
 */
router.post('/check-email', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw ApiError.badRequest('Email is required');
  }

  const result = await superAdminPool.query(
    'SELECT id FROM public.tenants WHERE admin_email = $1',
    [email]
  );

  const available = result.rows.length === 0;
  return ApiResponse.ok(res, {
    available,
    message: available ? 'Email available' : 'Email already registered'
  });
}));

module.exports = router;
