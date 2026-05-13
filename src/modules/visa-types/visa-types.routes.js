'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./visa-types.controller');
const v = require('./visa-types.validator');

const router = Router();
router.use(authenticate, tenantResolver);

router.get('/', validateWithJoi(v.listingQuery, 'query'), ctrl.list);
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
router.delete(
  '/:id',
  requireRole('admin', 'hr_admin'),
  validateWithJoi(v.idParam, 'params'),
  ctrl.remove,
);

module.exports = router;
