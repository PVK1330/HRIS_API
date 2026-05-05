// src/modules/superadmin/plans.routes.js
const express = require('express');
const router = express.Router();
const {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  addFeature,
  removeFeature,
  updateFeatures
} = require('./plans.controller');

/**
 * GET /api/v1/superadmin/plans
 * Get all subscription plans
 */
router.get('/', getAllPlans);

/**
 * GET /api/v1/superadmin/plans/:id
 * Get plan by ID
 */
router.get('/:id', getPlanById);

/**
 * POST /api/v1/superadmin/plans
 * Create new subscription plan
 */
router.post('/', createPlan);

/**
 * PUT /api/v1/superadmin/plans/:id
 * Update subscription plan
 */
router.put('/:id', updatePlan);

/**
 * DELETE /api/v1/superadmin/plans/:id
 * Delete subscription plan (soft delete)
 */
router.delete('/:id', deletePlan);

/**
 * POST /api/v1/superadmin/plans/:id/features
 * Add feature to plan
 */
router.post('/:id/features', addFeature);

/**
 * DELETE /api/v1/superadmin/plans/:id/features/:feature
 * Remove feature from plan
 */
router.delete('/:id/features/:feature', removeFeature);

/**
 * PUT /api/v1/superadmin/plans/:id/features
 * Update features list
 */
router.put('/:id/features', updateFeatures);

module.exports = router;
