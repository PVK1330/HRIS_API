'use strict';

const express = require('express');
const router  = express.Router();

const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./dashboard.controller');

// All dashboard routes require authentication + tenant context
router.use(authenticate, loadAuthContext);

/**
 * GET /api/v1/dashboard/attendance
 * Requires ATTENDANCE_VIEW or ATTENDANCE_VIEW_ALL
 */
router.get(
  '/attendance',
  requireAnyPermission(P.ATTENDANCE_VIEW, P.ATTENDANCE_VIEW_ALL),
  ctrl.getAttendanceDashboard,
);

/**
 * GET /api/v1/dashboard/manager
 * Requires ATTENDANCE_VIEW_TEAM
 */
router.get(
  '/manager',
  requirePermission(P.ATTENDANCE_VIEW_TEAM),
  ctrl.getManagerDashboard,
);

/**
 * GET /api/v1/dashboard/payroll
 * Requires PAYROLL_VIEW
 */
router.get(
  '/payroll',
  requirePermission(P.PAYROLL_VIEW),
  ctrl.getPayrollDashboard,
);

/**
 * GET /api/v1/dashboard/leave
 * Requires LEAVE_VIEW
 */
router.get(
  '/leave',
  requirePermission(P.LEAVE_VIEW),
  ctrl.getLeaveDashboard,
);

module.exports = router;
