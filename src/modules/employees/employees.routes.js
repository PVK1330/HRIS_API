'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const ctrl = require('./employees.controller');
const empV = require('./employees.validator');

// Sub-module routes
const { employeeRouter: attendanceEmpRoutes, adminRouter: attendanceAdminRoutes } = require('./attendance/attendance.routes');
const { employeeRouter: leaveEmpRoutes,      adminRouter: leaveAdminRoutes }      = require('./leave/leave.routes');
const documentsRoutes   = require('./documents/documents.routes');
const performanceRoutes = require('./performance/performance.routes');
const assetsRoutes      = require('./assets/assets.routes');

const router = Router();
router.use(authenticate, requireRole('superadmin', 'admin', 'hr_admin', 'hr_executive', 'manager'));

// ─── Read-only ────────────────────────────────────────────────────────────────
router.get('/stats',   ctrl.stats);
router.get('/filters', ctrl.filterOptions);
router.get('/filter-options', ctrl.filterOptions);

router.get('/export', validateWithJoi(empV.exportQuery, 'query'), ctrl.exportList);

router.get('/', validateWithJoi(empV.listingQuery, 'query'), ctrl.list);

router.get('/dropdown', validateWithJoi(empV.dropdownQuery, 'query'), ctrl.dropdownList);

router.get('/:id', [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
], validate, ctrl.getOne);

// ─── Write (hr_admin / admin only) ───────────────────────────────────────────
router.post('/', requireRole('admin', 'hr_admin'), [
  body('empId').exists({ checkFalsy: true }).withMessage('empId is required').isString().trim().isLength({ max: 20 }),
  body('fullName').exists({ checkFalsy: true }).withMessage('fullName is required').isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').exists({ checkFalsy: true }).withMessage('jobTitle is required').isString().trim(),
  body('department').exists({ checkFalsy: true }).withMessage('department is required').isString().trim(),
  body('employmentType').exists({ checkFalsy: true }).withMessage('employmentType is required').isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').exists({ checkFalsy: true }).withMessage('joinDate is required').isDate(),
  body('workEmail').exists({ checkFalsy: true }).withMessage('workEmail is required').isEmail().normalizeEmail(),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated']),
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

router.patch('/:id', requireRole('admin', 'hr_admin'), [
  param('id').isInt({ min: 1 }),
  body('fullName').optional().isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').optional().isString().trim(),
  body('department').optional().isString().trim(),
  body('employmentType').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').optional().isDate(),
  body('workEmail').optional().isEmail().normalizeEmail(),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated']),
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

router.put('/:id', requireRole('admin', 'hr_admin'), [
  param('id').isInt({ min: 1 }),
  body('fullName').optional().isString().trim().isLength({ min: 2, max: 255 }),
  body('jobTitle').optional().isString().trim(),
  body('department').optional().isString().trim(),
  body('employmentType').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Intern']),
  body('joinDate').optional().isDate(),
  body('workEmail').optional().isEmail().normalizeEmail(),
  body('dateOfBirth').optional({ nullable: true }).isDate(),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('salary').optional({ nullable: true }).isFloat({ min: 0 }),
  body('employmentStatus').optional().isIn(['Active', 'Probation', 'Notice Period', 'On Leave', 'Terminated']),
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

router.delete('/:id', requireRole('admin', 'hr_admin'), [
  param('id').isInt({ min: 1 }),
], validate, ctrl.remove);

// ─── Employee sub-resources ───────────────────────────────────────────────────
router.use('/:employeeId/attendance',  attendanceEmpRoutes);
router.use('/:employeeId/leave',       leaveEmpRoutes);
router.use('/:employeeId/documents',   documentsRoutes);
router.use('/:employeeId/performance', performanceRoutes);
router.use('/:employeeId/assets',      assetsRoutes);

// ─── Admin-level attendance & leave (exported for app.js) ────────────────────
module.exports = router;
module.exports.attendanceAdminRoutes = attendanceAdminRoutes;
module.exports.leaveAdminRoutes      = leaveAdminRoutes;
