'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
} = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/employeePerformanceController');

const router = Router();

// Apply dynamic multi-tenant authentication to all routes
router.use(authenticate, loadAuthContext);

// Dropdown APIs
router.get('/performance-cycles/dropdown', ctrl.getCyclesDropdown);
router.get('/competencies/dropdown', ctrl.getCompetenciesDropdown);

// Summary count metrics
router.get('/summary', ctrl.getSummaryMetrics);

// Manager Portal - Manager assigned assessments
router.get('/manager', ctrl.getManagerAssignedAssessments);

// Manager update goal details
router.patch('/:id/manager-goals', ctrl.updateManagerGoals);

// Admin approval endpoint
router.patch('/:id/approve', ctrl.approveAssessment);

// Employee Portal Specific
router.get('/employee/:employeeId', ctrl.getAssessmentsByEmployeeId);
router.get('/performance-summary/:employeeId', ctrl.getEmployeePerformanceSummary);
router.put('/:id/progress', ctrl.updateEmployeeProgress);

// General CRUD operations
router.get('/', ctrl.getAllAssessments);
router.post('/', ctrl.createAssessment);
router.get('/:id', ctrl.getAssessmentById);
router.put('/:id', ctrl.updateAssessment);
router.delete('/:id', ctrl.deleteAssessment);

module.exports = router;
