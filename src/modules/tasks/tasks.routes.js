'use strict';

const express = require('express');
const router = express.Router();
const tasksController = require('./tasks.controller');
const { authenticate, loadAuthContext, requirePermission } = require('../../middlewares/auth.middleware');

router.use(authenticate, loadAuthContext);
router.use(requirePermission('tasks'));

router.get('/', tasksController.getTasks);
router.post('/', tasksController.createTask);

router.get('/:id', tasksController.getTask);
router.put('/:id', tasksController.updateTask);
router.delete('/:id', tasksController.deleteTask);

router.post('/:id/comments', tasksController.addComment);
router.post('/:id/attachments', tasksController.addAttachment);

module.exports = router;
