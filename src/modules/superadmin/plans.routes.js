// src/modules/superadmin/plans.routes.js
const express = require('express');
const router = express.Router();
const plansRepository = require('./plans.repository');
const ApiResponse = require('../../utils/ApiResponse');

/**
 * GET /api/v1/superadmin/plans
 * Get all subscription plans
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined
    };
    const plans = await plansRepository.findAll(filters);
    return ApiResponse.ok(res, plans, 'Plans retrieved successfully');
  } catch (error) {
    console.error('Error fetching plans:', error);
    return ApiResponse.error(res, 'Failed to fetch plans', 500);
  }
});

/**
 * GET /api/v1/superadmin/plans/:id
 * Get plan by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }
    return ApiResponse.ok(res, plan, 'Plan retrieved successfully');
  } catch (error) {
    console.error('Error fetching plan:', error);
    return ApiResponse.error(res, 'Failed to fetch plan', 500);
  }
});

/**
 * POST /api/v1/superadmin/plans
 * Create new subscription plan
 */
router.post('/', async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive
    } = req.body;

    // Validation
    if (!name || !code) {
      return ApiResponse.error(res, 'Name and code are required', 400);
    }

    // Check if code already exists
    const existingPlan = await plansRepository.findByCode(code);
    if (existingPlan) {
      return ApiResponse.error(res, 'Plan code already exists', 409);
    }

    const plan = await plansRepository.create({
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive
    });

    return ApiResponse.created(res, plan, 'Plan created successfully');
  } catch (error) {
    console.error('Error creating plan:', error);
    return ApiResponse.error(res, 'Failed to create plan', 500);
  }
});

/**
 * PUT /api/v1/superadmin/plans/:id
 * Update subscription plan
 */
router.put('/:id', async (req, res) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }

    // Check if code is being changed and if new code already exists
    if (req.body.code && req.body.code !== plan.code) {
      const existingPlan = await plansRepository.findByCode(req.body.code);
      if (existingPlan) {
        return ApiResponse.error(res, 'Plan code already exists', 409);
      }
    }

    const updatedPlan = await plansRepository.update(req.params.id, req.body);
    return ApiResponse.ok(res, updatedPlan, 'Plan updated successfully');
  } catch (error) {
    console.error('Error updating plan:', error);
    return ApiResponse.error(res, 'Failed to update plan', 500);
  }
});

/**
 * DELETE /api/v1/superadmin/plans/:id
 * Delete subscription plan (soft delete)
 */
router.delete('/:id', async (req, res) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }

    const deletedPlan = await plansRepository.delete(req.params.id);
    return ApiResponse.ok(res, deletedPlan, 'Plan deleted successfully');
  } catch (error) {
    console.error('Error deleting plan:', error);
    return ApiResponse.error(res, 'Failed to delete plan', 500);
  }
});

/**
 * POST /api/v1/superadmin/plans/:id/features
 * Add feature to plan
 */
router.post('/:id/features', async (req, res) => {
  try {
    const { feature } = req.body;
    if (!feature) {
      return ApiResponse.error(res, 'Feature is required', 400);
    }

    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }

    const updatedPlan = await plansRepository.addFeature(req.params.id, feature);
    return ApiResponse.ok(res, updatedPlan, 'Feature added successfully');
  } catch (error) {
    console.error('Error adding feature:', error);
    return ApiResponse.error(res, 'Failed to add feature', 500);
  }
});

/**
 * DELETE /api/v1/superadmin/plans/:id/features/:feature
 * Remove feature from plan
 */
router.delete('/:id/features/:feature', async (req, res) => {
  try {
    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }

    const updatedPlan = await plansRepository.removeFeature(req.params.id, req.params.feature);
    return ApiResponse.ok(res, updatedPlan, 'Feature removed successfully');
  } catch (error) {
    console.error('Error removing feature:', error);
    return ApiResponse.error(res, 'Failed to remove feature', 500);
  }
});

/**
 * PUT /api/v1/superadmin/plans/:id/features
 * Update features list
 */
router.put('/:id/features', async (req, res) => {
  try {
    const { features } = req.body;
    if (!Array.isArray(features)) {
      return ApiResponse.error(res, 'Features must be an array', 400);
    }

    const plan = await plansRepository.findById(req.params.id);
    if (!plan) {
      return ApiResponse.error(res, 'Plan not found', 404);
    }

    const updatedPlan = await plansRepository.updateFeatures(req.params.id, features);
    return ApiResponse.ok(res, updatedPlan, 'Features updated successfully');
  } catch (error) {
    console.error('Error updating features:', error);
    return ApiResponse.error(res, 'Failed to update features', 500);
  }
});

module.exports = router;
