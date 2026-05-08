'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./attendanceSettings.controller');
const {
  mergeFlatAttendanceFields,
  EARLY_DEPARTURE_RULES,
  WHO_CAN_SUBMIT,
  APPROVERS,
  OVERTIME_CALC_RULES,
  OVERTIME_APPROVAL,
  TIME_RE,
} = require('./attendanceSettings.service');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

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
  body('auto_calculate_hours').optional().isBoolean(),
  body('ten_minute_buffer').optional().isBoolean(),
  body('late_mark_auto_calculation').optional().isBoolean(),
  body('overtime_eligibility').optional().isBoolean(),
];

router.get('/', controller.getAttendanceSettings);
router.put('/', normalizeBody, putValidators, validate, controller.updateAttendanceSettings);

module.exports = router;
