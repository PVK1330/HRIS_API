'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('./payrollEngine.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');

router.use(authenticate, loadAuthContext);

// ── Salary Components ─────────────────────────────────────────────────────────
router.get('/components',     requirePermission(P.PAYROLL_VIEW),   ctrl.listComponents);
router.post('/components',    requirePermission(P.PAYROLL_MANAGE), ctrl.createComponent);
router.put('/components/:id', requirePermission(P.PAYROLL_MANAGE), ctrl.updateComponent);
router.delete('/components/:id', requirePermission(P.PAYROLL_MANAGE), ctrl.deleteComponent);

// ── Salary Structures ─────────────────────────────────────────────────────────
// NOTE: /structures/assign must be declared before /structures/:id to avoid
//       Express matching "assign" as the :id parameter.
router.get('/structures',          requirePermission(P.PAYROLL_VIEW),   ctrl.listStructures);
router.post('/structures',         requirePermission(P.PAYROLL_MANAGE), ctrl.createStructure);
router.post('/structures/assign',  requirePermission(P.PAYROLL_MANAGE), ctrl.assignStructureToEmployee);
router.put('/structures/:id',      requirePermission(P.PAYROLL_MANAGE), ctrl.updateStructure);

// ── Pay Periods ───────────────────────────────────────────────────────────────
router.get('/pay-periods',  requirePermission(P.PAYROLL_VIEW),   ctrl.listPayPeriods);
router.post('/pay-periods', requirePermission(P.PAYROLL_MANAGE), ctrl.createPayPeriod);

// ── Payroll Runs ──────────────────────────────────────────────────────────────
// NOTE: /runs/export must be declared before /runs/:id so Express does not match
//       the literal "export" as an :id parameter value.
router.get('/runs',              requirePermission(P.PAYROLL_VIEW),   ctrl.listPayrollRuns);
router.post('/runs',             requirePermission(P.PAYROLL_MANAGE), ctrl.initPayrollRun);
router.get('/runs/export',       requirePermission(P.PAYROLL_VIEW),   ctrl.exportRunsList);
router.get('/runs/:id',          requirePermission(P.PAYROLL_VIEW),   ctrl.getPayrollRun);
router.get('/runs/:id/export',   requirePermission(P.PAYROLL_VIEW),   ctrl.exportRunDetail);
router.put('/runs/:id/approve',  requirePermission(P.PAYROLL_MANAGE), ctrl.approvePayrollRun);
router.post('/runs/:id/payslips',requirePermission(P.PAYROLL_MANAGE), ctrl.generatePayslips);

// ── Payslips ──────────────────────────────────────────────────────────────────
router.get('/my-payslips',   requirePermission(P.PAYROLL_VIEW), ctrl.getEmployeePayslips);
router.get('/payslips/:id',  requirePermission(P.PAYROLL_VIEW), ctrl.getPayslipDetail);

module.exports = router;
