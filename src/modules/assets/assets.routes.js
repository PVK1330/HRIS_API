'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./assets.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');

router.use(authenticate, tenantResolver, loadAuthContext);
router.use(requirePermission(P.ASSETS_VIEW));

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
