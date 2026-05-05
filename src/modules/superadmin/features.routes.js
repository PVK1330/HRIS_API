// src/modules/superadmin/features.routes.js
const express = require('express');
const router = express.Router();
const {
  getAllFeatures,
  getActiveFeatures,
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
 * GET /api/v1/superadmin/features/active
 * Get active features
 */
router.get('/active', getActiveFeatures);

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
