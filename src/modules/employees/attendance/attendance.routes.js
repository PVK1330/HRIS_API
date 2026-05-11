'use strict';

const { Router } = require('express');
const { param, query } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./attendance.controller');

// Mounted at /api/v1/employees/:employeeId/attendance
// Auth is applied by the parent employees router
const router = Router({ mergeParams: true });

router.get('/', [
  param('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('month').optional().isInt({ min: 1, max: 12 }),
], validate, ctrl.list);

module.exports = router;
