'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole, requirePermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./departments.controller');

const router = Router();

// Apply global middlewares
router.use(authenticate, tenantResolver);

router.get('/', ctrl.list);

router.get('/:id', [
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.getOne);

router.post('/', [
  requirePermission('departments'),
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('status')
    .custom((value, { req }) => {
      const status = value ?? req.body.isActive ?? req.body.is_active;
      if (status === undefined || status === null || status === '') {
        throw new Error('Status is required');
      }
      if (typeof status === 'boolean') return true;
      const normalized = String(status).toLowerCase();
      if (normalized !== 'active' && normalized !== 'inactive') {
        throw new Error('Status must be Active or Inactive');
      }
      return true;
    }),
  body('description').optional({ nullable: true }).isString().trim(),
  body('isActive').optional().isBoolean(),
  body('is_active').optional().isBoolean()
], validate, ctrl.create);

router.patch('/:id', [
  requirePermission('departments'),
  param('id').isInt().withMessage('ID must be an integer'),
  body('name').optional().notEmpty().trim(),
  body('status')
    .optional()
    .custom((value) => {
      const normalized = String(value).toLowerCase();
      if (normalized !== 'active' && normalized !== 'inactive') {
        throw new Error('Status must be Active or Inactive');
      }
      return true;
    }),
  body('description').optional({ nullable: true }).isString().trim(),
  body('isActive').optional().isBoolean(),
  body('is_active').optional().isBoolean()
], validate, ctrl.update);

router.delete('/:id', [
  requirePermission('departments'),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.remove);

module.exports = router;
