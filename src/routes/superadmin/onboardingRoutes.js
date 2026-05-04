// src/routes/superadmin/onboardingRoutes.js
const express = require('express');
const router = express.Router();
const { superadminOnboardTenant, completeOnboarding } = require('../../services/onboardingService');
const { superadminPool } = require('../../config/db');

/**
 * POST /api/superadmin/onboarding/tenant
 * Superadmin onboards a new tenant (Admin company)
 */
router.post('/tenant', async (req, res) => {
  try {
    const superadminId = req.user?.id; // Assuming auth middleware sets req.user
    if (!superadminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await superadminOnboardTenant(req.body, superadminId);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Tenant onboarded successfully. Temporary password sent to admin email.'
    });
  } catch (error) {
    console.error('Error onboarding tenant:', error);
    res.status(500).json({ error: error.message || 'Failed to onboard tenant' });
  }
});

/**
 * GET /api/superadmin/onboarding/pending
 * Get tenants with pending/in-progress onboarding
 */
router.get('/pending', async (req, res) => {
  try {
    const result = await superadminPool.query(
      `SELECT id, company_name, admin_email, admin_name, admin_phone,
              plan_id, subscription_status, onboarding_status, created_at
       FROM public.tenants
       WHERE onboarding_status IN ('pending', 'in_progress')
       ORDER BY created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching pending onboarding:', error);
    res.status(500).json({ error: 'Failed to fetch pending onboarding' });
  }
});

/**
 * PUT /api/superadmin/onboarding/:tenantId/complete
 * Mark tenant onboarding as complete
 */
router.put('/:tenantId/complete', async (req, res) => {
  try {
    const result = await completeOnboarding(req.params.tenantId);
    res.json({ 
      success: true,
      data: result,
      message: 'Onboarding marked as complete'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * GET /api/superadmin/onboarding/subscription-plans
 * Get available subscription plans
 */
router.get('/subscription-plans', async (req, res) => {
  try {
    const result = await superadminPool.query(
      `SELECT id, name, code, description, max_users, max_storage_mb,
              price_monthly, price_yearly, features, is_active
       FROM public.subscription_plans
       WHERE is_active = true
       ORDER BY price_monthly ASC`
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

module.exports = router;
