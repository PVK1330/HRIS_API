'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const {
  authenticate,
  loadAuthContext,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const { P } = require('../../constants/permissions');
const controller = require('./attendanceSettings.controller');
const {
  mergeFlatAttendanceFields,
  EARLY_DEPARTURE_RULES,
  WHO_CAN_SUBMIT,
  APPROVERS,
  OVERTIME_CALC_RULES,
  OVERTIME_APPROVAL,
  OVERTIME_APPROVERS,
  TIME_RE,
} = require('./attendanceSettings.service');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

function normalizeBody(req, _res, next) {
  req.body = mergeFlatAttendanceFields(req.body || {});
  next();
}

const putValidators = [
  body('work_start_time').optional({ values: 'falsy' }).matches(TIME_RE),
  body('work_end_time').optional({ values: 'falsy' }).matches(TIME_RE),
  body('break_duration_minutes').optional().isInt({ min: 0, max: 120 }),
  body('total_required_hours').optional().isFloat({ min: 1, max: 24 }),
  body('min_hours_for_present').optional().isFloat({ min: 1, max: 24 }),
  body('grace_days_per_month').optional().isInt({ min: 0, max: 31 }),
  body('auto_rejection_after_days').optional().isInt({ min: 1, max: 30 }),
  body('early_departure_rule').optional().isIn(EARLY_DEPARTURE_RULES),
  body('who_can_submit_request').optional().isIn(WHO_CAN_SUBMIT),
  body('approver').optional().isIn(APPROVERS),
  body('overtime_calculation_rule').optional().isIn(OVERTIME_CALC_RULES),
  body('overtime_approval_workflow').optional().isIn(OVERTIME_APPROVAL),
  body('overtime_minimum_threshold_minutes').optional().isInt({ min: 0, max: 720 }),
  body('overtime_max_per_month_hours').optional().isFloat({ min: 0, max: 744 }),
  body('overtime_approver').optional().isIn(OVERTIME_APPROVERS),
  body('overtime_require_reason').optional().isBoolean(),
  body('overtime_custom_multiplier').optional().isFloat({ min: 1, max: 10 }),
  // Shift settings
  body('shift_type_default').optional().isString(),
  body('shift_allow_employee_view').optional().isBoolean(),
  body('shift_change_request_enabled').optional().isBoolean(),
  // Regularisation settings
  body('regularization_allow_self').optional().isBoolean(),
  body('regularization_max_per_month').optional().isInt({ min: 0, max: 31 }),
  body('regularization_auto_approve_enabled').optional().isBoolean(),
  body('regularization_auto_approve_after_days').optional().isInt({ min: 0, max: 30 }),
  // General settings
  body('work_week_days').optional().isString(),
  body('grace_period_minutes').optional().isInt({ min: 0, max: 120 }),
  body('half_day_threshold_hours').optional().isFloat({ min: 0, max: 24 }),
  body('biometric_sync_enabled').optional().isBoolean(),
  body('wfh_marking_allowed').optional().isBoolean(),
  body('auto_calculate_hours').optional().isBoolean(),
  body('ten_minute_buffer').optional().isBoolean(),
  body('late_mark_auto_calculation').optional().isBoolean(),
  body('overtime_eligibility').optional().isBoolean(),
];

router.get(
  '/',
  requireAnyPermission(
    P.ATTENDANCE_SETTINGS_VIEW,
    P.ATTENDANCE_SETTINGS_MANAGE,
    P.ATTENDANCE_MANAGE,
  ),
  controller.getAttendanceSettings,
);

router.put(
  '/',
  requireAnyPermission(P.ATTENDANCE_SETTINGS_MANAGE, P.ATTENDANCE_MANAGE),
  normalizeBody,
  putValidators,
  validate,
  controller.updateAttendanceSettings,
);

module.exports = router;
