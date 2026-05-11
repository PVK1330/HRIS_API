'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const ctrl = require('./assets.controller');

const router = Router({ mergeParams: true });

router.get('/', [
  param('employeeId').isInt({ min: 1 }),
], validate, ctrl.list);

module.exports = router;
