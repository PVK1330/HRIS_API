'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./assets.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');

router.use(authenticate);
router.use(tenantResolver);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
