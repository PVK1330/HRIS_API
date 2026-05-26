'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
} = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/performanceExport.controller');

const router = Router();

// Apply dynamic multi-tenant authentication to all routes
router.use(authenticate, loadAuthContext);

// Get all performance cycles
router.get('/cycles', ctrl.getPerformanceCycles);

// Export performance data
router.post('/export', ctrl.exportPerformanceData);

module.exports = router;
