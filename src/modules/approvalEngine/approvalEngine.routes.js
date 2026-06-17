'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./approvalEngine.controller');

const router = Router();

router.use(authenticate, loadAuthContext);

// ─── Workflow configuration (admin / HR manager) ──────────────────────────────
router.get('/workflows',     requirePermission(P.APPROVAL_MANAGE), ctrl.listWorkflows);
router.post('/workflows',    requirePermission(P.APPROVAL_MANAGE), ctrl.createWorkflow);
router.get('/workflows/:id', requirePermission(P.APPROVAL_MANAGE), ctrl.getWorkflow);
router.put('/workflows/:id', requirePermission(P.APPROVAL_MANAGE), ctrl.updateWorkflow);

// ─── Inbox: approvals waiting on the logged-in actor ─────────────────────────
router.get('/pending', requirePermission(P.APPROVAL_VIEW), ctrl.getPendingApprovals);

// ─── Employee's own submitted requests ───────────────────────────────────────
router.get('/my-requests', requirePermission(P.APPROVAL_VIEW), ctrl.getMyRequests);

// ─── Submit a new approval request ───────────────────────────────────────────
router.post('/requests', requirePermission(P.APPROVAL_VIEW), ctrl.createRequest);

// ─── Approve / reject / escalate a specific request ──────────────────────────
router.put('/requests/:id/action', requirePermission(P.APPROVAL_VIEW), ctrl.actOnRequest);

// ─── Approval delegations ─────────────────────────────────────────────────────
router.get('/delegations',     requirePermission(P.APPROVAL_VIEW), ctrl.listDelegations);
router.post('/delegations',    requirePermission(P.APPROVAL_VIEW), ctrl.createDelegation);
router.delete('/delegations/:id', requirePermission(P.APPROVAL_VIEW), ctrl.revokeDelegation);

module.exports = router;
