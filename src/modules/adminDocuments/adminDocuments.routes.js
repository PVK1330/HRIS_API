'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./adminDocuments.controller');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/', requirePermission(P.DOCUMENT_VIEW), ctrl.listAll);

router.put(
  '/:id/status',
  requirePermission(P.DOCUMENT_UPLOAD),
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['Approved', 'Rejected']),
    body('rejection_reason').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.updateStatus
);

module.exports = router;
