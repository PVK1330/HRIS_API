'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, loadAuthContext, requirePermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./locations.controller');
const v = require('./locations.validator');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/',    requirePermission(P.LOCATIONS_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.list);
router.get('/:id', requirePermission(P.LOCATIONS_MANAGE), validateWithJoi(v.idParam, 'params'),    ctrl.getOne);
router.post('/',   requirePermission(P.LOCATIONS_MANAGE), validateWithJoi(v.createBody, 'body'),   ctrl.create);
router.put('/:id', requirePermission(P.LOCATIONS_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update
);
router.delete('/:id', requirePermission(P.LOCATIONS_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
