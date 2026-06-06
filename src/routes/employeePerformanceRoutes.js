'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../middlewares/auth.middleware');
const { P } = require('../constants/permissions');
const ctrl = require('../controllers/employeePerformanceController');

const router = Router();

// Apply dynamic multi-tenant authentication to all routes
router.use(authenticate, loadAuthContext);

// Dropdown APIs (any user who can view performance)
router.get('/performance-cycles/dropdown', requirePermission(P.PERFORMANCE_VIEW), ctrl.getCyclesDropdown);
router.get('/competencies/dropdown', requirePermission(P.PERFORMANCE_VIEW), ctrl.getCompetenciesDropdown);

// Summary count metrics
router.get('/summary', requirePermission(P.PERFORMANCE_VIEW), ctrl.getSummaryMetrics);

// Aggregated analytics for the Performance Reports dashboard
router.get('/analytics', requirePermission(P.PERFORMANCE_VIEW), ctrl.getPerformanceAnalytics);

// Manager Portal - Manager assigned assessments
router.get('/manager', requireAnyPermission(P.PERFORMANCE_REVIEW, P.PERFORMANCE_VIEW_TEAM, P.PERFORMANCE_VIEW), ctrl.getManagerAssignedAssessments);

// Manager update goal details
router.patch('/:id/manager-goals', requirePermission(P.PERFORMANCE_REVIEW), ctrl.updateManagerGoals);

// Admin approval endpoint
router.patch('/:id/approve', requirePermission(P.PERFORMANCE_APPROVE), ctrl.approveAssessment);

// Employee Portal Specific (employee reads/updates their own assessment)
router.get('/employee/:employeeId', requireAnyPermission(P.PERFORMANCE_VIEW_OWN, P.PERFORMANCE_VIEW), ctrl.getAssessmentsByEmployeeId);
router.get('/performance-summary/:employeeId', requireAnyPermission(P.PERFORMANCE_VIEW_OWN, P.PERFORMANCE_VIEW), ctrl.getEmployeePerformanceSummary);
router.put('/:id/progress', requireAnyPermission(P.PERFORMANCE_VIEW_OWN, P.PERFORMANCE_VIEW), ctrl.updateEmployeeProgress);

// General CRUD operations (admin / performance managers)
router.get('/', requirePermission(P.PERFORMANCE_VIEW), ctrl.getAllAssessments);
router.post('/', requirePermission(P.PERFORMANCE_MANAGE), ctrl.createAssessment);
router.get('/:id', requirePermission(P.PERFORMANCE_VIEW), ctrl.getAssessmentById);
router.put('/:id', requirePermission(P.PERFORMANCE_MANAGE), ctrl.updateAssessment);
router.delete('/:id', requirePermission(P.PERFORMANCE_MANAGE), ctrl.deleteAssessment);

module.exports = router;
