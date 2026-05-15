'use strict';

const express = require('express');
const router = express.Router();
const payrollController = require('./payroll.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// All routes require tenant authentication
router.use(authenticate);

// Salary Routes
router.get('/salaries', requireRole(['admin', 'hr']), payrollController.getSalaries);
router.post('/salaries', requireRole(['admin', 'hr']), payrollController.upsertSalary);

// Items Routes
router.get('/items', requireRole(['admin', 'hr']), payrollController.getItems);
router.post('/items', requireRole(['admin', 'hr']), payrollController.createItem);

module.exports = router;
