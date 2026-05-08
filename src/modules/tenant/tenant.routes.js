'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./tenant.controller');

const router = Router();
 
router.post(
  '/create',
  authenticate,
  requireRole('superadmin'),
  [
    body('name')
      .exists({ checkFalsy: true }).withMessage('name is required').bail()
      .isString().withMessage('name must be a string')
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('name must be between 2 and 255 characters'),

    body('adminEmail')
      .exists({ checkFalsy: true }).withMessage('adminEmail is required').bail()
      .isEmail().withMessage('adminEmail must be a valid email')
      .trim()
      .normalizeEmail(),

    body('adminName')
      .exists({ checkFalsy: true }).withMessage('adminName is required').bail()
      .isString().withMessage('adminName must be a string')
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('adminName must be between 2 and 255 characters'),

    body('adminPassword')
      .exists({ checkFalsy: true }).withMessage('adminPassword is required').bail()
      .isString().withMessage('adminPassword must be a string')
      .isLength({ min: 8, max: 128 }).withMessage('adminPassword must be between 8 and 128 characters'),

    body('plan_id')
      .optional()
      .isString().withMessage('plan_id must be a string')
      .trim(),
  ],
  validate,
  controller.createTenant
);

/**
 * GET /api/v1/tenants
 * SuperAdmin-only: list all tenants.
 */
router.get(
  '/',
  authenticate,
  requireRole('superadmin'),
  controller.getTenants
);

router.patch(
  '/:id',
  authenticate,
  requireRole('superadmin'),
  controller.updateTenant
);

router.delete(
  '/:id',
  authenticate,
  requireRole('superadmin'),
  controller.deleteTenant
);

router.post(
  '/:id/reset-password',
  authenticate,
  requireRole('superadmin'),
  controller.resetTenantPassword
);

router.post(
  '/:id/login-as',
  authenticate,
  requireRole('superadmin'),
  controller.loginAsTenant
);

router.get(
  '/:id/features',
  authenticate,
  requireRole('superadmin'),
  controller.getTenantFeatures
);

router.patch(
  '/:id/features/:featureId',
  authenticate,
  requireRole('superadmin'),
  [
    body('isEnabled')
      .exists().withMessage('isEnabled is required').bail()
      .isBoolean().withMessage('isEnabled must be a boolean'),
  ],
  validate,
  controller.updateTenantFeature
);

module.exports = router;
