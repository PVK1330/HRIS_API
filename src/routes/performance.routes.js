'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../middlewares/auth.middleware');
const { P } = require('../constants/permissions');
const ctrl = require('../controllers/performanceExport.controller');

const router = Router();

// Apply dynamic multi-tenant authentication to all routes
router.use(authenticate, loadAuthContext);

// Get all performance cycles
router.get('/cycles', requirePermission(P.PERFORMANCE_VIEW), ctrl.getPerformanceCycles);

// Export performance data
router.post('/export', requirePermission(P.PERFORMANCE_VIEW), ctrl.exportPerformanceData);

module.exports = router;
