'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('./shifts.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');

router.use(authenticate, loadAuthContext);

// ─── Shifts ──────────────────────────────────────────────────────────────────

router.get('/', requirePermission(P.SHIFT_VIEW), ctrl.listShifts);
router.post('/', requirePermission(P.SHIFT_MANAGE), ctrl.createShift);

// ─── Assignments (declared before /:id to avoid route shadowing) ─────────────

router.get('/assignments', requirePermission(P.SHIFT_VIEW), ctrl.listAssignments);
router.post('/assignments', requirePermission(P.SHIFT_MANAGE), ctrl.assignShift);
router.post('/assignments/bulk', requirePermission(P.SHIFT_MANAGE), ctrl.bulkAssignShift);
router.get(
  '/assignments/employee/:employeeId/current',
  requirePermission(P.SHIFT_VIEW),
  ctrl.getEmployeeCurrentShift,
);
router.delete('/assignments/:id', requirePermission(P.SHIFT_MANAGE), ctrl.removeAssignment);

// ─── Change Requests ─────────────────────────────────────────────────────────

router.get('/change-requests', requirePermission(P.SHIFT_VIEW), ctrl.listChangeRequests);
router.post('/change-requests', requirePermission(P.SHIFT_CHANGE_REQUEST), ctrl.createChangeRequest);
router.put(
  '/change-requests/:id/action',
  requireAnyPermission(P.SHIFT_APPROVE, P.SHIFT_MANAGE),
  ctrl.approveChangeRequest,
);

// ─── Shift by ID (declared last to avoid shadowing sub-paths) ────────────────

router.get('/:id', requirePermission(P.SHIFT_VIEW), ctrl.getShift);
router.put('/:id', requirePermission(P.SHIFT_MANAGE), ctrl.updateShift);
router.delete('/:id', requirePermission(P.SHIFT_MANAGE), ctrl.deleteShift);

module.exports = router;
