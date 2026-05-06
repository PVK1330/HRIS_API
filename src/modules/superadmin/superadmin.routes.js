'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./superadmin.controller');
const featuresRouter = require('./features.routes');
const plansRouter = require('./plans.routes');
const paymentsRouter = require('./payments.routes');

const router = Router();

/**
 * POST /api/v1/superadmin/login
 */
router.post(
  '/login',
  [
    body('email')
      .exists({ checkFalsy: true }).withMessage('email is required').bail()
      .isEmail().withMessage('email must be a valid email')
      .trim()
      .normalizeEmail(),
    body('password')
      .exists({ checkFalsy: true }).withMessage('password is required').bail()
      .isString().withMessage('password must be a string')
      .isLength({ min: 8 }).withMessage('password must be at least 8 characters'),
  ],
  validate,
  controller.login
);

/**
 * POST /api/v1/superadmin/verify-2fa
 */
router.post(
  '/verify-2fa',
  [
    body('userId').exists().withMessage('userId is required'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('code must be 6 digits'),
  ],
  validate,
  controller.verify2FA
);

router.get(
  '/admin-users',
  authenticate,
  requireRole('superadmin'),
  controller.getAdminUsers
);

router.post(
  '/admin-users',
  authenticate,
  requireRole('superadmin'),
  [
    body('name').exists({ checkFalsy: true }).withMessage('name is required').trim(),
    body('email').exists({ checkFalsy: true }).withMessage('email is required').isEmail().withMessage('email must be valid').trim().normalizeEmail(),
    body('password').exists({ checkFalsy: true }).withMessage('password is required').isLength({ min: 8 }).withMessage('password must be at least 8 characters'),
    body('role').optional().isString().withMessage('role must be a string'),
    body('status').optional().isString().withMessage('status must be a string'),
  ],
  validate,
  controller.createAdminUser
);

router.patch(
  '/admin-users/:id',
  authenticate,
  requireRole('superadmin'),
  [
    body('name').optional().isString().withMessage('name must be a string').trim(),
    body('role').optional().isString().withMessage('role must be a string'),
    body('status').optional().isString().withMessage('status must be a string'),
  ],
  validate,
  controller.updateAdminUser
);

router.get(
  '/permissions',
  authenticate,
  requireRole('superadmin'),
  controller.getPermissions
);

router.post(
  '/permissions',
  authenticate,
  requireRole('superadmin'),
  [
    body('name').exists({ checkFalsy: true }).withMessage('name is required').isString().withMessage('name must be a string').trim(),
    body('description').optional().isString().withMessage('description must be a string'),
    body('permissions').optional().isObject().withMessage('permissions must be an object'),
  ],
  validate,
  controller.createRole
);

router.patch(
  '/permissions/:roleKey',
  authenticate,
  requireRole('superadmin'),
  [
    body('name').optional().isString().withMessage('name must be a string').trim(),
    body('description').optional().isString().withMessage('description must be a string'),
    body('permissions').optional().isObject().withMessage('permissions must be an object'),
  ],
  validate,
  controller.updateRole
);

router.get(
  '/modules',
  authenticate,
  requireRole('superadmin'),
  controller.getModules
);

router.patch(
  '/modules/:moduleKey',
  authenticate,
  requireRole('superadmin'),
  [
    body('isEnabled').isBoolean().withMessage('isEnabled must be a boolean'),
  ],
  validate,
  controller.updateModule
);

router.get(
  '/announcements',
  authenticate,
  requireRole('superadmin'),
  controller.getAnnouncements
);

router.post(
  '/announcements',
  authenticate,
  requireRole('superadmin'),
  [
    body('title').exists({ checkFalsy: true }).withMessage('title is required').isString().trim(),
    body('message').exists({ checkFalsy: true }).withMessage('message is required').isString(),
    body('audience').optional().isString().withMessage('audience must be a string'),
    body('type').optional().isString().withMessage('type must be a string'),
  ],
  validate,
  controller.createAnnouncement
);

router.patch(
  '/announcements/:id',
  authenticate,
  requireRole('superadmin'),
  [
    body('title').optional().isString().withMessage('title must be a string').trim(),
    body('message').optional().isString().withMessage('message must be a string'),
    body('audience').optional().isString().withMessage('audience must be a string'),
    body('type').optional().isString().withMessage('type must be a string'),
  ],
  validate,
  controller.updateAnnouncement
);

router.delete(
  '/announcements/:id',
  authenticate,
  requireRole('superadmin'),
  controller.deleteAnnouncement
);

/**
 * Mount features routes
 * All features routes will be prefixed with /features
 */
router.use('/features', authenticate, requireRole('superadmin'), featuresRouter);
router.use('/plans', authenticate, requireRole('superadmin'), plansRouter);
router.use('/payments', authenticate, requireRole('superadmin'), paymentsRouter);

module.exports = router;
