'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./adminDocuments.controller');

const router = Router();

router.use(authenticate, tenantResolver, requireRole('superadmin', 'admin', 'hr_admin', 'hr_executive'));

router.get('/', ctrl.listAll);

router.put(
  '/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['Approved', 'Rejected']),
    body('rejection_reason').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.updateStatus
);

module.exports = router;
