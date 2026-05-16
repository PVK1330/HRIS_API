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
const ctrl = require('./visa-types.controller');
const v = require('./visa-types.validator');

const router = Router();
router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', requirePermission(P.VISA_VIEW), validateWithJoi(v.listingQuery, 'query'), ctrl.list);
router.get('/:id', requirePermission(P.VISA_VIEW), validateWithJoi(v.idParam, 'params'), ctrl.getOne);
router.post(
  '/',
  requirePermission(P.VISA_MANAGE),
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);
router.put(
  '/:id',
  requirePermission(P.VISA_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);
router.delete(
  '/:id',
  requirePermission(P.VISA_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  ctrl.remove,
);

module.exports = router;
