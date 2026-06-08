'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requireAnyPermission,
} = require('../middlewares/auth.middleware');
const { P } = require('../constants/permissions');
const ctrl = require('../controllers/employeePerformanceController');

const router = Router();
router.use(authenticate, loadAuthContext);

const canReviewTeam = requireAnyPermission(
  P.PERFORMANCE_REVIEW,
  P.PERFORMANCE_VIEW_TEAM,
  P.PERFORMANCE_VIEW,
);

// Manager Performance Review endpoints
router.get('/reviews', canReviewTeam, ctrl.getManagerReviewList);
router.get('/reviews/:id', canReviewTeam, ctrl.getManagerReviewById);

// Manager Department endpoint - get the department assigned to this manager
router.get('/department', canReviewTeam, ctrl.getManagerDepartment);

module.exports = router;
