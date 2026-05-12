'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requirePermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./departments.controller');

const router = Router();

router.use(authenticate, tenantResolver);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 2000 }),
    query('search').optional().isString().trim(),
    query('status').optional().isIn(['all', 'active', 'inactive', 'All', 'Active', 'Inactive']),
  ],
  validate,
  ctrl.list,
);

router.get('/managers', ctrl.listManagers);

router.get(
  '/:id',
  [param('id').isInt().withMessage('ID must be an integer')],
  validate,
  ctrl.getOne,
);

router.post(
  '/',
  [
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
    body('manager_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('managerId').optional({ nullable: true }).isInt({ min: 1 }),
    body('isActive').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.create,
);

router.patch(
  '/:id',
  [
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
    body('manager_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('managerId').optional({ nullable: true }).isInt({ min: 1 }),
    body('isActive').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.update,
);

router.delete(
  '/:id',
  [
    requirePermission('departments'),
    param('id').isInt().withMessage('ID must be an integer'),
  ],
  validate,
  ctrl.remove,
);

module.exports = router;
