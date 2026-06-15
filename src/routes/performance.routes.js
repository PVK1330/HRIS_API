'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../middlewares/auth.middleware');
const { tenantResolver } = require('../middlewares/tenant.middleware');
const { P } = require('../constants/permissions');
const ctrl = require('../controllers/performanceExport.controller');

const router = Router();

// Apply dynamic multi-tenant authentication to all routes
router.use(authenticate, tenantResolver, loadAuthContext);

// Get all performance cycles
router.get('/cycles', requirePermission(P.PERFORMANCE_VIEW), ctrl.getPerformanceCycles);

// Get performance cycles that a specific employee has assessments in
router.get('/employee-cycles', requirePermission(P.PERFORMANCE_VIEW), ctrl.getEmployeePerformanceCycles);

// Export performance data
router.post('/export', requirePermission(P.PERFORMANCE_VIEW), ctrl.exportPerformanceData);

module.exports = router;
