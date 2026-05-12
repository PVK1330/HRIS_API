'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./designations.controller');

const router = Router();

router.use(authenticate, tenantResolver);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 2000 }),
    query('search').optional().isString().trim(),
    query('status').optional().isIn(['all', 'active', 'inactive', 'All', 'Active', 'Inactive']),
    query('departmentId').optional().isInt({ min: 1 }),
    query('department_id').optional().isInt({ min: 1 }),
    query('departmentName').optional().isString().trim(),
    query('department_name').optional().isString().trim(),
  ],
  validate,
  ctrl.list,
);

router.get(
  '/by-department/:deptName',
  [param('deptName').notEmpty().withMessage('deptName is required')],
  validate,
  ctrl.listByDepartment,
);

router.get(
  '/:id',
  [param('id').isInt().withMessage('ID must be an integer')],
  validate,
  ctrl.getOne,
);

router.post(
  '/',
  [
    requireRole('admin', 'hr_admin'),
    body('name').notEmpty().withMessage('Designation name is required').trim(),
    body('departmentId')
      .custom((value, { req }) => {
        const candidate = value ?? req.body.department_id;
        if (candidate === undefined || candidate === null || candidate === '') {
          throw new Error('Department is required');
        }
        if (Number.isNaN(Number(candidate))) {
          throw new Error('Department must be a valid ID');
        }
        return true;
      }),
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
    body('department_id').optional({ nullable: true }).isInt(),
    body('description').optional({ nullable: true }).isString().trim(),
    body('isActive').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.create,
);

router.patch(
  '/:id',
  [
    requireRole('admin', 'hr_admin'),
    param('id').isInt().withMessage('ID must be an integer'),
    body('name').optional().notEmpty().trim(),
    body('departmentId').optional().isInt(),
    body('department_id').optional().isInt(),
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
    body('is_active').optional().isBoolean(),
  ],
  validate,
  ctrl.update,
);

router.delete(
  '/:id',
  [
    requireRole('admin', 'hr_admin'),
    param('id').isInt().withMessage('ID must be an integer'),
  ],
  validate,
  ctrl.remove,
);

module.exports = router;
