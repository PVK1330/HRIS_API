'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadReceipt, uploadExcel } = require('../../middlewares/upload.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./expenses.controller');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

// Stats (before /:id)
router.get('/statistics', ctrl.getStats);
router.get('/summary', ctrl.getStats);

// Approval-level config (EXP-02) — before /:id
router.get('/approval-levels', ctrl.getApprovalLevels);
router.put('/approval-levels', requirePermission(P.EXPENSES_MANAGE), ctrl.setApprovalLevels);

// Excel export (EXP-10) — all authenticated users (scoped by role in controller)
router.get('/export', ctrl.exportExpenses);

// Excel import (EXP-30) — admin only
router.get('/import/template', ctrl.downloadImportTemplate);
router.post('/import', requirePermission(P.EXPENSES_MANAGE), uploadExcel('file'), ctrl.importExpenses);

// Claims CRUD
router.get('/', ctrl.list);
router.post('/create', uploadReceipt('receipt'), ctrl.create);
router.post('/', uploadReceipt('receipt'), ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', uploadReceipt('receipt'), ctrl.update);
router.put('/:id/status', requirePermission(P.EXPENSES_APPROVE), ctrl.updateStatus);
router.delete('/:id', ctrl.remove);

module.exports = router;
