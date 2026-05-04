// src/routes/public/onboardingRoutes.js
const express = require('express');
const router = express.Router();
const { adminSelfOnboard, completeOnboarding } = require('../../services/onboardingService');
const { superadminPool } = require('../../config/db');

/**
 * POST /api/public/onboarding/self
 * Admin self-onboarding (creates tenant account)
 */
router.post('/self', async (req, res) => {
  try {
    const result = await adminSelfOnboard(req.body);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Account created successfully. Please log in to complete setup.'
    });
  } catch (error) {
    console.error('Error in self-onboarding:', error);
    if (error.message === 'Email already registered') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: error.message || 'Failed to create account' });
  }
});

/**
 * GET /api/public/onboarding/subscription-plans
 * Get available subscription plans (public endpoint)
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

/**
 * POST /api/public/onboarding/check-email
 * Check if email is available for registration
 */
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await superadminPool.query(
      'SELECT id FROM public.tenants WHERE admin_email = $1',
      [email]
    );

    res.json({ 
      available: result.rows.length === 0,
      message: result.rows.length === 0 ? 'Email available' : 'Email already registered'
    });
  } catch (error) {
    console.error('Error checking email:', error);
    res.status(500).json({ error: 'Failed to check email availability' });
  }
});

module.exports = router;
