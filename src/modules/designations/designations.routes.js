'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./designations.controller');
const v = require('./designations.validator');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.list);

router.get('/filter-options', requirePermission(P.DEPARTMENTS_MANAGE), ctrl.filterOptions);

router.get('/export', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);

router.get(
  '/by-department/:deptName',
  requirePermission(P.DEPARTMENTS_MANAGE),
  validateWithJoi(v.deptNameParam, 'params'),
  ctrl.listByDepartment,
);

router.get('/:id', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/',
  requirePermission(P.DEPARTMENTS_MANAGE),
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);

router.put(
  '/:id',
  requirePermission(P.DEPARTMENTS_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);

router.delete('/:id', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
