'use strict';

const { Router } = require('express');
const { param, query } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./leave.controller');

const router = Router({ mergeParams: true });

router.get('/', [
  param('employeeId').isInt({ min: 1 }),
  query('year').optional().isInt({ min: 2000, max: 2100 }),
  query('status').optional().isString().trim(),
], validate, ctrl.list);

module.exports = router;
