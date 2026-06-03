'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./assets.controller');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', requirePermission(P.ASSETS_VIEW), controller.list);
router.get('/:id', requirePermission(P.ASSETS_VIEW), controller.getOne);
router.post('/', requirePermission(P.ASSETS_CREATE), controller.create);
router.put('/:id', requireAnyPermission(P.ASSETS_EDIT, P.ASSETS_ASSIGN), controller.update);
router.delete('/:id', requirePermission(P.ASSETS_DELETE), controller.remove);

module.exports = router;
