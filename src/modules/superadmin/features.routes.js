// src/modules/superadmin/features.routes.js
const express = require('express');
const router = express.Router();
const {
  getAllFeatures,
  getCategories,
  getFeaturesByCategory,
  getFeatureById,
  createFeature,
  updateFeature,
  deleteFeature,
  activateFeature,
  deactivateFeature
} = require('./features.controller');

/**
 * GET /api/v1/superadmin/features
 * Get all features
 */
router.get('/', getAllFeatures);

/**
 * GET /api/v1/superadmin/features/categories
 * Get all feature categories
 */
router.get('/categories', getCategories);

/**
 * GET /api/v1/superadmin/features/category/:category
 * Get features by category
 */
router.get('/category/:category', getFeaturesByCategory);

/**
 * GET /api/v1/superadmin/features/:id
 * Get feature by ID
 */
router.get('/:id', getFeatureById);

/**
 * POST /api/v1/superadmin/features
 * Create new feature
 */
router.post('/', createFeature);

/**
 * PUT /api/v1/superadmin/features/:id
 * Update feature
 */
router.put('/:id', updateFeature);

/**
 * DELETE /api/v1/superadmin/features/:id
 * Delete feature (soft delete)
 */
router.delete('/:id', deleteFeature);

/**
 * POST /api/v1/superadmin/features/:id/activate
 * Activate feature
 */
router.post('/:id/activate', activateFeature);

/**
 * POST /api/v1/superadmin/features/:id/deactivate
 * Deactivate feature
 */
router.post('/:id/deactivate', deactivateFeature);

module.exports = router;
