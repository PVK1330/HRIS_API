'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const controller = require('./auth.controller');
const { authLimiter } = require('../../middlewares/rateLimit.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');

const router = Router();

/**
 * Public Authentication Routes
 */

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  controller.login
);

router.post(
  '/forgot-password',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  ],
  validate,
  controller.forgotPassword
);

router.post(
  '/verify-otp',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  controller.verifyOtp
);

router.post(
  '/reset-password',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  controller.resetPassword
);

router.get(
  '/access-profile',
  authenticate,
  controller.getAccessProfile
);

module.exports = router;
