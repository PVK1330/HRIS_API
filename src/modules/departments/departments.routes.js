'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
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
  requireRole('admin', 'hr_admin'),
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('code').notEmpty().withMessage('Code is required').trim(),
  body('managerId').optional({ nullable: true }).isInt(),
  body('isActive').optional().isBoolean()
], validate, ctrl.create);

router.patch('/:id', [
  requireRole('admin', 'hr_admin'),
  param('id').isInt().withMessage('ID must be an integer'),
  body('name').optional().notEmpty().trim(),
  body('code').optional().notEmpty().trim()
], validate, ctrl.update);

router.delete('/:id', [
  requireRole('admin', 'hr_admin'),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.remove);

module.exports = router;
