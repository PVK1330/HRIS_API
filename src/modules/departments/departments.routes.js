'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, requirePermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./departments.controller');
const v = require('./departments.validator');

const router = Router();

router.use(authenticate, tenantResolver);

router.get('/', validateWithJoi(v.listingQuery, 'query'), ctrl.list);

router.get('/filter-options', validateWithJoi(v.filterOptionsQuery, 'query'), ctrl.filterOptions);

router.get('/export', validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);

router.get('/managers', ctrl.listManagers);

router.get('/:id', validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/',
  requirePermission('departments'),
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);

router.put(
  '/:id',
  requirePermission('departments'),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);

router.delete('/:id', requirePermission('departments'), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
