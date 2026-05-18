'use strict';

/**
 * ============================================================================
 * Performance Cycles Routes
 * ============================================================================
 * Defines all API endpoints for performance cycle management:
 * - POST   /api/v1/performance-cycles - Create new cycle
 * - GET    /api/v1/performance-cycles - List all cycles
 * - GET    /api/v1/performance-cycles/:id - Get single cycle
 * - PUT    /api/v1/performance-cycles/:id - Update cycle
 * - DELETE /api/v1/performance-cycles/:id - Delete cycle
 * - GET    /api/v1/performance-cycles/summary - Get summary stats
 * ============================================================================
 */

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./performanceCycles.controller');
const v = require('./performanceCycles.validator');

const router = Router();

// Apply authentication to all routes
router.use(authenticate, loadAuthContext);

/**
 * ─── Read Operations ────────────────────────────────────────────────────
 */

/**
 * GET /api/v1/performance-cycles/summary
 * Get summary statistics of performance cycles
 * Permissions: PERFORMANCE_VIEW (or admin)
 */
router.get(
  '/summary',
  requirePermission(P.PERFORMANCE_VIEW),
  ctrl.getSummary,
);

/**
 * GET /api/v1/performance-cycles
 * Get all performance cycles with search and filters
 * Query params: search, status, page, limit
 * Permissions: PERFORMANCE_VIEW (or admin)
 */
router.get(
  '/',
  requirePermission(P.PERFORMANCE_VIEW),
  validateWithJoi(v.querySchema, 'query'),
  ctrl.getAllCycles,
);

/**
 * GET /api/v1/performance-cycles/:id
 * Get a single performance cycle by ID
 * Permissions: PERFORMANCE_VIEW (or admin)
 */
router.get(
  '/:id',
  requirePermission(P.PERFORMANCE_VIEW),
  validateWithJoi(v.paramsSchema, 'params'),
  ctrl.getCycleById,
);

/**
 * ─── Write Operations ──────────────────────────────────────────────────
 */

/**
 * POST /api/v1/performance-cycles
 * Create a new performance cycle
 * Required fields: cycleName, startDate, endDate, submissionDeadline
 * Optional fields: automatedReminder
 * Permissions: PERFORMANCE_MANAGE (or admin)
 */
router.post(
  '/',
  requirePermission(P.PERFORMANCE_MANAGE),
  validateWithJoi(v.createCycleSchema, 'body'),
  ctrl.createCycle,
);

/**
 * PUT /api/v1/performance-cycles/:id
 * Update a performance cycle
 * All fields are optional
 * Permissions: PERFORMANCE_MANAGE (or admin)
 */
router.put(
  '/:id',
  requirePermission(P.PERFORMANCE_MANAGE),
  validateWithJoi(v.paramsSchema, 'params'),
  validateWithJoi(v.updateCycleSchema, 'body'),
  ctrl.updateCycle,
);

/**
 * DELETE /api/v1/performance-cycles/:id
 * Delete a performance cycle (soft delete)
 * Permissions: PERFORMANCE_MANAGE (or admin)
 */
router.delete(
  '/:id',
  requirePermission(P.PERFORMANCE_MANAGE),
  validateWithJoi(v.paramsSchema, 'params'),
  ctrl.deleteCycle,
);

module.exports = router;
