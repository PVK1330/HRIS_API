'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./employees.controller');
const empV = require('./employees.validator');

// Sub-module routes
const { employeeRouter: attendanceEmpRoutes, adminRouter: attendanceAdminRoutes } = require('./attendance/attendance.routes');
const { employeeRouter: leaveEmpRoutes,      adminRouter: leaveAdminRoutes }      = require('./leave/leave.routes');
const documentsRoutes   = require('./documents/documents.routes');
const performanceRoutes = require('./performance/performance.routes');
const assetsRoutes      = require('./assets/assets.routes');
const onboardingRoutes  = require('./onboarding/onboarding.routes');

const router = Router();
router.use(authenticate, loadAuthContext);

// ─── Read-only ────────────────────────────────────────────────────────────────
router.get('/stats', requirePermission(P.EMPLOYEE_VIEW), ctrl.stats);
router.get('/filters', requirePermission(P.EMPLOYEE_VIEW), ctrl.filterOptions);
router.get('/filter-options', requirePermission(P.EMPLOYEE_VIEW), ctrl.filterOptions);
router.get('/gdpr/export', requirePermission(P.EMPLOYEE_VIEW), ctrl.gdprExport);

router.get('/next-emp-id', requirePermission(P.EMPLOYEE_CREATE), ctrl.nextEmpId);

router.get('/export', requirePermission(P.EMPLOYEE_VIEW), validateWithJoi(empV.exportQuery, 'query'), ctrl.exportList);

router.get('/', requirePermission(P.EMPLOYEE_VIEW), validateWithJoi(empV.listingQuery, 'query'), ctrl.list);

router.get('/dropdown', requireAnyPermission(P.EMPLOYEE_VIEW, P.ATTENDANCE_MANAGE, P.ATTENDANCE_APPROVE), validateWithJoi(empV.dropdownQuery, 'query'), ctrl.dropdownList);

router.get(
  '/designations-for-department',
  requirePermission(P.EMPLOYEE_VIEW),
  ctrl.designationsForDepartment,
);

router.use(onboardingRoutes);

// Sub-resources must be registered before `/:id` so paths like `/123/documents` are not
// captured by the single-segment employee profile route.
router.use('/:employeeId/attendance',  attendanceEmpRoutes);
router.use('/:employeeId/leave',       leaveEmpRoutes);
router.use('/:employeeId/documents',   documentsRoutes);
router.use('/:employeeId/performance', performanceRoutes);
router.use('/:employeeId/assets',      assetsRoutes);

router.get('/:id', requirePermission(P.EMPLOYEE_VIEW), [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
], validate, ctrl.getOne);

router.post('/:id/complete-onboarding', requirePermission(P.EMPLOYEE_EDIT), [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
], validate, ctrl.completeOnboarding);

// ─── Write ───────────────────────────────────────────────────────────────────
router.post('/', requirePermission(P.EMPLOYEE_CREATE), empV.createRules(), validate, ctrl.create);

router.patch('/:id', requirePermission(P.EMPLOYEE_EDIT), [
  param('id').isInt({ min: 1 }),
  ...empV.updateRules(),
], validate, ctrl.update);

router.put('/:id', requirePermission(P.EMPLOYEE_EDIT), [
  param('id').isInt({ min: 1 }),
  ...empV.updateRules(),
], validate, ctrl.update);

router.delete('/:id', requirePermission(P.EMPLOYEE_DELETE), [
  param('id').isInt({ min: 1 }),
], validate, ctrl.remove);

// ─── Admin-level attendance & leave (exported for app.js) ────────────────────
module.exports = router;
module.exports.attendanceAdminRoutes = attendanceAdminRoutes;
module.exports.leaveAdminRoutes      = leaveAdminRoutes;
