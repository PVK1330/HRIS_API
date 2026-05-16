'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const { requirePermission } = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const { requireEmployeeScopeAccess } = require('../../../middlewares/employeeScope.middleware');
const ctrl = require('./performance.controller');

const router = Router({ mergeParams: true });

router.use(requirePermission(P.PERFORMANCE_VIEW));
router.use(requireEmployeeScopeAccess('employeeId'));

router.get('/', [
  param('employeeId').isInt({ min: 1 }),
], validate, ctrl.list);

module.exports = router;
