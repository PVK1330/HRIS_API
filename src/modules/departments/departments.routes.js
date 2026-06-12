'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, loadAuthContext, requirePermission } = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./departments.controller');
const v = require('./departments.validator');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.list);

router.get('/filter-options', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.filterOptionsQuery, 'query'), ctrl.filterOptions);

router.get('/export', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);

router.get('/managers', requirePermission(P.DEPARTMENTS_MANAGE), validateWithJoi(v.managersQuery, 'query'), ctrl.listManagers);

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

router.delete(
  '/:id',
  requirePermission(P.DEPARTMENTS_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.deleteQuery, 'query'),
  ctrl.remove,
);

module.exports = router;
