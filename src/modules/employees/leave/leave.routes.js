'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./leave.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const { requireEmployeeScopeAccess } = require('../../../middlewares/employeeScope.middleware');

// ─── Employee-scoped: mounted at /api/v1/employees/:employeeId/leave ──────────
const employeeRouter = Router({ mergeParams: true });

employeeRouter.use(requirePermission(P.LEAVE_VIEW));
employeeRouter.use(requireEmployeeScopeAccess('employeeId'));

employeeRouter.get('/', [
  param('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('status').optional().isString().trim(),
], validate, ctrl.list);

// ─── Admin-level: mounted at /api/v1/leave ────────────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticate, loadAuthContext);
adminRouter.use(requirePermission(P.LEAVE_VIEW));

adminRouter.get('/types', ctrl.getTypes);

adminRouter.get('/balances', [
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('department').optional().isString().trim(),
  query('search').optional().isString().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, ctrl.balances);

adminRouter.get('/', [
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('status').optional().isString().trim(),
  query('department').optional().isString().trim(),
  query('search').optional().isString().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, ctrl.listAll);

adminRouter.post('/', [
  requirePermission(P.LEAVE_APPLY),
  body('employeeId').isInt({ min: 1 }).withMessage('employeeId required'),
  body('leaveType').notEmpty().isString().trim().withMessage('leaveType required'),
  body('fromDate').isDate().withMessage('fromDate required (YYYY-MM-DD)'),
  body('toDate').isDate().withMessage('toDate required (YYYY-MM-DD)'),
  body('reason').notEmpty().isString().trim().withMessage('reason required'),
  body('totalDays').optional({ nullable: true }).isInt({ min: 1 }),
  body('handoverNote').optional().isString().trim(),
  body('isDraft').optional().isBoolean(),
], validate, ctrl.apply);

adminRouter.patch('/:id', [
  param('id').isInt({ min: 1 }),
  body('action').isIn(['approve', 'reject', 'cancel', 'submit']).withMessage('action must be approve, reject, cancel, or submit'),
  body('reason').optional().isString().trim(),
], validate, (req, res, next) => {
  const action = req.body?.action;
  const perm = (action === 'approve' || action === 'reject')
    ? P.LEAVE_APPROVE
    : P.LEAVE_APPLY;
  return requirePermission(perm)(req, res, next);
}, ctrl.process);

// Roll unused balances into a new leave year (also runs automatically via yearly cron).
adminRouter.post('/carry-forward', [
  requirePermission(P.LEAVE_APPROVE),
  body('year').optional().isInt({ min: 2000, max: 2100 }),
], validate, ctrl.carryForward);

module.exports = { employeeRouter, adminRouter };
