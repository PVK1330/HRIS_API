'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const ctrl = require('./messages.controller');

const router = Router();
router.use(authenticate, requireRole('admin', 'hr_admin', 'hr_executive', 'manager', 'employee'));

router.get('/unread', ctrl.unreadCount);

router.get('/conversations', ctrl.listConversations);

router.post('/conversations', [
  body('otherEmployeeId').isInt({ min: 1 }).withMessage('otherEmployeeId required'),
], validate, ctrl.openConversation);

router.get('/conversations/:id/messages', [
  param('id').isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isInt({ min: 1 }),
], validate, ctrl.getMessages);

router.post('/conversations/:id/messages', [
  param('id').isInt({ min: 1 }),
  body('body').notEmpty().isString().trim().isLength({ max: 4000 }),
], validate, ctrl.sendMessage);

module.exports = router;
