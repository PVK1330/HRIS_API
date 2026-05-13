'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./designations.controller');
const v = require('./designations.validator');

const router = Router();

router.use(authenticate, tenantResolver);

router.get('/', validateWithJoi(v.listingQuery, 'query'), ctrl.list);

router.get('/filter-options', ctrl.filterOptions);

router.get('/export', validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);

router.get(
  '/by-department/:deptName',
  validateWithJoi(v.deptNameParam, 'params'),
  ctrl.listByDepartment,
);

router.get('/:id', validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/',
  requireRole('admin', 'hr_admin'),
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);

router.put(
  '/:id',
  requireRole('admin', 'hr_admin'),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);

router.delete('/:id', requireRole('admin', 'hr_admin'), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
