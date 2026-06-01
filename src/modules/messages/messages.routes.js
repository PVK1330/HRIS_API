'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const {
  authenticate,
  requireRole,
} = require('../../middlewares/auth.middleware');
const { messageFileMiddleware } = require('./messages.upload');
const ctrl = require('./messages.controller');

const router = Router();

/* Messages are available to all tenant workspace users — no RBAC permission gate */
router.use(authenticate, requireRole('admin', 'employee', 'hr_admin', 'hr_executive', 'manager'));

router.get('/contacts', ctrl.listContacts);

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

router.post(
  '/conversations/:id/messages/upload',
  [
    param('id').isInt({ min: 1 }),
    body('body').optional().isString().trim().isLength({ max: 4000 }),
  ],
  validate,
  messageFileMiddleware,
  ctrl.sendMessageAttachment,
);

module.exports = router;
