'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./announcements.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');

router.use(authenticate, tenantResolver);

router.get('/', controller.getAll);
router.get('/stats', controller.getStats);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
