'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
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
const { isValidWorkEmail } = require('../../utils/validateWorkEmail');

function workEmailRules({ requiredUnlessOnboarding = false } = {}) {
  return body('workEmail')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val, { req }) => {
      const onboarding = req.body.employmentStatus === 'Onboarding';
      if ((requiredUnlessOnboarding || !onboarding) && !val) {
        throw new Error('workEmail is required');
      }
      if (val && !isValidWorkEmail(val)) {
        throw new Error('Invalid work email');
      }
      return true;
    });
}

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

router.get('/dropdown', requirePermission(P.EMPLOYEE_VIEW), validateWithJoi(empV.dropdownQuery, 'query'), ctrl.dropdownList);

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
router.post('/', requirePermission(P.EMPLOYEE_CREATE), [
  body('empId').optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
  body('fullName').exists({ checkFalsy: true }).withMessage('fullName is required').isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').exists({ checkFalsy: true }).withMessage('jobTitle is required').isString().trim(),
  body('department').exists({ checkFalsy: true }).withMessage('department is required').isString().trim(),
  body('departmentId').optional({ nullable: true }).isInt({ min: 1 }),
  body('employmentType').exists({ checkFalsy: true }).withMessage('employmentType is required').isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').exists({ checkFalsy: true }).withMessage('joinDate is required').isDate(),
  body('firstName').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('lastName').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  workEmailRules({ requiredUnlessOnboarding: true }),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated', 'Onboarding']),
  body('probationEndDate').optional({ nullable: true }).isDate(),
  body('passportExpiry').optional({ nullable: true }).isDate(),
  body('emiratesIdExpiry').optional({ nullable: true }).isDate(),
  body('visaExpiryDate').optional({ nullable: true }).isDate(),
  body('dependents').optional({ nullable: true }).isInt({ min: 0 }),
  body('rbacRoleId').optional({ nullable: true }).isInt({ min: 1 }),
  body('portalEnabled').optional().isBoolean(),
  body('portalPassword').optional({ checkFalsy: true }).isString().trim().isLength({ min: 8, max: 200 }),
  body('username').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('religion').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body('employmentSpouse').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('bankName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('bankAccountNo').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('ifscCode').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('branchAddress').optional({ nullable: true }).isString().trim(),
  body('familyMembers').optional({ nullable: true }).isArray(),
  body('secondaryContact').optional({ nullable: true }).isObject(),
  body('education').optional({ nullable: true }).isArray(),
  body('workExperience').optional({ nullable: true }).isArray(),
  body('isCurrentlyWorking').optional().isBoolean(),
  body('documents').optional({ nullable: true }).isArray(),
  body('bankDetails').optional({ nullable: true }).isObject(),
  body('addresses').optional({ nullable: true }).isArray(),
  body('emergencyContacts').optional({ nullable: true }).isArray(),
  body('educationDetails').optional({ nullable: true }).isArray(),
  body('experienceDetails').optional({ nullable: true }).isArray(),
  body('salaryDetails').optional({ nullable: true }).isObject(),
  body('profileImageBase64').optional({ nullable: true }).isString(),
  body('costCenter').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
], validate, ctrl.create);

router.patch('/:id', requirePermission(P.EMPLOYEE_EDIT), [
  param('id').isInt({ min: 1 }),
  body('fullName').optional().isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').optional().isString().trim(),
  body('department').optional().isString().trim(),
  body('departmentId').optional({ nullable: true }).isInt({ min: 1 }),
  body('employmentType').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').optional().isDate(),
  workEmailRules(),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated', 'Onboarding']),
  body('probationEndDate').optional({ nullable: true }).isDate(),
  body('passportExpiry').optional({ nullable: true }).isDate(),
  body('emiratesIdExpiry').optional({ nullable: true }).isDate(),
  body('visaExpiryDate').optional({ nullable: true }).isDate(),
  body('dependents').optional({ nullable: true }).isInt({ min: 0 }),
  body('rbacRoleId').optional({ nullable: true }).isInt({ min: 1 }),
  body('portalEnabled').optional().isBoolean(),
  body('portalPassword').optional({ checkFalsy: true }).isString().trim().isLength({ min: 8, max: 200 }),
  body('username').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('religion').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body('employmentSpouse').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('bankName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('bankAccountNo').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('ifscCode').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('branchAddress').optional({ nullable: true }).isString().trim(),
  body('familyMembers').optional({ nullable: true }).isArray(),
  body('secondaryContact').optional({ nullable: true }).isObject(),
  body('education').optional({ nullable: true }).isArray(),
  body('workExperience').optional({ nullable: true }).isArray(),
  body('isCurrentlyWorking').optional().isBoolean(),
  body('documents').optional({ nullable: true }).isArray(),
  body('bankDetails').optional({ nullable: true }).isObject(),
  body('addresses').optional({ nullable: true }).isArray(),
  body('emergencyContacts').optional({ nullable: true }).isArray(),
  body('educationDetails').optional({ nullable: true }).isArray(),
  body('experienceDetails').optional({ nullable: true }).isArray(),
  body('salaryDetails').optional({ nullable: true }).isObject(),
  body('profileImageBase64').optional({ nullable: true }).isString(),
  body('costCenter').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
], validate, ctrl.update);

router.put('/:id', requirePermission(P.EMPLOYEE_EDIT), [
  param('id').isInt({ min: 1 }),
  body('fullName').optional().isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').optional().isString().trim(),
  body('department').optional().isString().trim(),
  body('employmentType').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').optional().isDate(),
  workEmailRules(),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated', 'Onboarding']),
  body('probationEndDate').optional({ nullable: true }).isDate(),
  body('passportExpiry').optional({ nullable: true }).isDate(),
  body('emiratesIdExpiry').optional({ nullable: true }).isDate(),
  body('visaExpiryDate').optional({ nullable: true }).isDate(),
  body('dependents').optional({ nullable: true }).isInt({ min: 0 }),
  body('rbacRoleId').optional({ nullable: true }).isInt({ min: 1 }),
  body('portalEnabled').optional().isBoolean(),
  body('portalPassword').optional({ checkFalsy: true }).isString().trim().isLength({ min: 8, max: 200 }),
  body('username').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('religion').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body('employmentSpouse').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('bankName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('bankAccountNo').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('ifscCode').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('branchAddress').optional({ nullable: true }).isString().trim(),
  body('familyMembers').optional({ nullable: true }).isArray(),
  body('secondaryContact').optional({ nullable: true }).isObject(),
  body('education').optional({ nullable: true }).isArray(),
  body('workExperience').optional({ nullable: true }).isArray(),
  body('isCurrentlyWorking').optional().isBoolean(),
  body('documents').optional({ nullable: true }).isArray(),
  body('bankDetails').optional({ nullable: true }).isObject(),
  body('addresses').optional({ nullable: true }).isArray(),
  body('emergencyContacts').optional({ nullable: true }).isArray(),
  body('educationDetails').optional({ nullable: true }).isArray(),
  body('experienceDetails').optional({ nullable: true }).isArray(),
  body('salaryDetails').optional({ nullable: true }).isObject(),
  body('profileImageBase64').optional({ nullable: true }).isString(),
  body('costCenter').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
], validate, ctrl.update);

router.delete('/:id', requirePermission(P.EMPLOYEE_DELETE), [
  param('id').isInt({ min: 1 }),
], validate, ctrl.remove);

// ─── Admin-level attendance & leave (exported for app.js) ────────────────────
module.exports = router;
module.exports.attendanceAdminRoutes = attendanceAdminRoutes;
module.exports.leaveAdminRoutes      = leaveAdminRoutes;
