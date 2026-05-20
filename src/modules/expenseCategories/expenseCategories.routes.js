'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./expenseCategories.controller');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', ctrl.list);
router.post('/', ctrl.requireTenantAdmin, ctrl.create);
router.get('/:id', ctrl.getOne);
router.put('/:id', ctrl.requireTenantAdmin, ctrl.update);
router.delete('/:id', ctrl.requireTenantAdmin, ctrl.remove);

module.exports = router;
