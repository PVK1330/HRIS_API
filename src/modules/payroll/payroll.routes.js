'use strict';

const express = require('express');
const router = express.Router();
const payrollController = require('./payroll.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');

router.use(authenticate, loadAuthContext);

router.get('/monthly-summary', requirePermission(P.PAYROLL_VIEW), payrollController.getMonthlySummary);
router.get('/salaries/export', requirePermission(P.PAYROLL_VIEW), payrollController.exportSalaries);
router.get('/salaries', requirePermission(P.PAYROLL_VIEW), payrollController.getSalaries);
router.post('/salaries', requirePermission(P.PAYROLL_MANAGE), payrollController.upsertSalary);
router.delete('/salaries/:id', requirePermission(P.PAYROLL_MANAGE), payrollController.deleteSalary);

router.get('/items', requirePermission(P.PAYROLL_VIEW), payrollController.getItems);
router.post('/items', requirePermission(P.PAYROLL_MANAGE), payrollController.createItem);

module.exports = router;
