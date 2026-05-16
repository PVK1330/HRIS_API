'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./attendance.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const { requireEmployeeScopeAccess } = require('../../../middlewares/employeeScope.middleware');

// ─── Employee-scoped: mounted at /api/v1/employees/:employeeId/attendance ─────
const employeeRouter = Router({ mergeParams: true });

employeeRouter.use(requirePermission(P.ATTENDANCE_VIEW));
employeeRouter.use(requireEmployeeScopeAccess('employeeId'));

employeeRouter.get('/', [
  param('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('month').optional().isInt({ min: 1, max: 12 }),
], validate, ctrl.list);

// ─── Admin-level: mounted at /api/v1/attendance ───────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticate, loadAuthContext);
adminRouter.use(requirePermission(P.ATTENDANCE_VIEW));

adminRouter.get('/regularizations', ctrl.pendingRegularizations);

adminRouter.get('/', [
  query('date').optional().isDate(),
  query('department').optional().isString().trim(),
  query('status').optional().isString().trim(),
  query('search').optional().isString().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, ctrl.listAll);

adminRouter.post('/', [
  body('employeeId').isInt({ min: 1 }).withMessage('employeeId required'),
  body('date').isDate().withMessage('date required (YYYY-MM-DD)'),
  body('workMode').isIn(['In Office', 'Remote', 'Field']).withMessage('Invalid workMode'),
  body('status').isIn(['Present', 'Absent', 'Half Day', 'Late', 'On Leave']).withMessage('Invalid status'),
  body('checkInTime').optional({ nullable: true }).matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('checkOutTime').optional({ nullable: true }).matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('overtimeHours').optional({ nullable: true }).isFloat({ min: 0 }),
  body('isLate').optional().isBoolean(),
  body('earlyDeparture').optional().isBoolean(),
  body('notes').optional().isString().trim(),
], validate, ctrl.mark);

adminRouter.patch('/:id/regularize', [
  param('id').isInt({ min: 1 }),
  body('action').isIn(['approve', 'reject']).withMessage('action must be approve or reject'),
  body('reason').optional().isString().trim(),
], validate, ctrl.regularize);

module.exports = { employeeRouter, adminRouter };
