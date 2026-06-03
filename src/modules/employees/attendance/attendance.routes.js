'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./attendance.controller');
const v = require('./attendanceValidators');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const { requireEmployeeScopeAccess } = require('../../../middlewares/employeeScope.middleware');

function anyViewPermission() {
  return (req, res, next) => {
    const { hasPermission } = require('../../../services/authz.service');
    const ok =
      hasPermission(req.auth, P.ATTENDANCE_VIEW_OWN)
      || hasPermission(req.auth, P.ATTENDANCE_VIEW_TEAM)
      || hasPermission(req.auth, P.ATTENDANCE_VIEW_ALL)
      || hasPermission(req.auth, P.ATTENDANCE_VIEW)
      || hasPermission(req.auth, P.ATTENDANCE_MANAGE);
    if (!ok) {
      const ApiError = require('../../../utils/ApiError');
      return next(ApiError.forbidden('Attendance view permission required'));
    }
    return next();
  };
}

const employeeRouter = Router({ mergeParams: true });
employeeRouter.use(anyViewPermission());
employeeRouter.use(requireEmployeeScopeAccess('employeeId'));

employeeRouter.get('/', [
  param('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('month').optional().isInt({ min: 1, max: 12 }),
], validate, ctrl.list);

const adminRouter = Router();
adminRouter.use(authenticate, loadAuthContext);

adminRouter.get(
  '/me/today',
  requireAnyPermission(
    P.ATTENDANCE_CREATE,
    P.ATTENDANCE_VIEW_OWN,
    P.ATTENDANCE_VIEW_TEAM,
    P.ATTENDANCE_VIEW_ALL,
  ),
  ctrl.myToday,
);
adminRouter.get('/dashboard', anyViewPermission(), [
  query('date').optional().isDate(),
], validate, ctrl.dashboard);

adminRouter.get('/reports/data', anyViewPermission(), [
  query('reportType').optional().isString().trim(),
  query('dateFrom').optional().isDate(),
  query('dateTo').optional().isDate(),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('month').optional().isInt({ min: 1, max: 12 }),
  query('employeeId').optional().isInt({ min: 1 }),
  query('department').optional().isString().trim(),
  query('designation').optional().isString().trim(),
  query('location').optional().isString().trim(),
  query('shiftId').optional().isInt({ min: 1 }),
  query('status').optional().isString().trim(),
], validate, ctrl.report);

adminRouter.get('/reports/export/pdf', anyViewPermission(), ctrl.exportPdf);
adminRouter.get('/reports/export/excel', anyViewPermission(), ctrl.exportExcel);

adminRouter.get('/regularizations', anyViewPermission(), ctrl.pendingRegularizations);
adminRouter.get('/regularizations/history', anyViewPermission(), [
  query('status').optional().isIn(['Pending', 'Approved', 'Rejected']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, ctrl.regularizationHistory);

adminRouter.get('/payroll-summary', anyViewPermission(), [
  query('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('month').optional().isInt({ min: 1, max: 12 }),
], validate, ctrl.payrollSummary);

adminRouter.get('/', anyViewPermission(), [
  query('date').optional().isDate(),
  query('department').optional().isString().trim(),
  query('status').optional().isString().trim(),
  query('search').optional().isString().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validate, ctrl.listAll);

adminRouter.post('/check-in', requirePermission(P.ATTENDANCE_CREATE), v.employeePunchBody, validate, ctrl.checkIn);

adminRouter.post('/check-out', requirePermission(P.ATTENDANCE_CREATE), v.employeePunchBody, validate, ctrl.checkOut);

adminRouter.post('/regularization', requirePermission(P.ATTENDANCE_REGULARIZATION_REQUEST), [
  body('employeeId').optional().isInt({ min: 1 }),
  body('date').isDate(),
  v.optionalReason,
  body('checkInTime').optional({ nullable: true, checkFalsy: false })
    .custom((val) => val == null || v.timePattern.test(String(val))),
  body('checkOutTime').optional({ nullable: true, checkFalsy: false })
    .custom((val) => val == null || v.timePattern.test(String(val))),
  body('workMode').optional().isString().trim(),
  v.optionalNotes,
], validate, ctrl.submitRegularization);

adminRouter.post('/override', requirePermission(P.ATTENDANCE_MANAGE), v.overrideBody, validate, ctrl.mark);
adminRouter.post('/', requirePermission(P.ATTENDANCE_MANAGE), v.overrideBody, validate, ctrl.mark);

adminRouter.get('/:id', anyViewPermission(), [param('id').isInt({ min: 1 })], validate, ctrl.detail);

adminRouter.patch('/:id/regularize', (req, res, next) => {
  const { hasPermission } = require('../../../services/authz.service');
  const ok =
    hasPermission(req.auth, P.ATTENDANCE_APPROVE)
    || hasPermission(req.auth, P.ATTENDANCE_REJECT)
    || hasPermission(req.auth, P.ATTENDANCE_MANAGE);
  if (!ok) {
    const ApiError = require('../../../utils/ApiError');
    return next(ApiError.forbidden('Approve or reject permission required'));
  }
  return next();
}, [
  param('id').isInt({ min: 1 }),
  body('action').isIn(['approve', 'reject']),
  v.optionalReason,
], validate, ctrl.regularize);

module.exports = { employeeRouter, adminRouter };
