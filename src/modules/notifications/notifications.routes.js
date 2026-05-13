'use strict';

const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const ctrl = require('./notifications.controller');

const router = Router();

router.use(authenticate);

router.get('/', ctrl.list);
router.patch('/mark-all-read', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.remove);

module.exports = router;
