'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const controller = require('./auth.controller');
const { authLimiter } = require('../../middlewares/rateLimit.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');

const router = Router();

function loginIdentifierValidator(value) {
  const v = String(value || '').trim();
  if (!v) throw new Error('Email or username is required');
  if (v.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      throw new Error('Enter a valid email address');
    }
    return true;
  }
  if (!/^[a-zA-Z0-9._-]{2,120}$/.test(v)) {
    throw new Error('Enter a valid portal username (letters, numbers, . _ -)');
  }
  return true;
}

router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email or username is required')
      .custom(loginIdentifierValidator)
      .customSanitizer((v) => String(v).trim().toLowerCase()),
    body('password').notEmpty().withMessage('Password is required'),
    body('tenantId').optional({ nullable: true }).isInt({ min: 1 }),
    body('tenantSlug').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  ],
  validate,
  controller.login,
);

router.post(
  '/forgot-password',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  ],
  validate,
  controller.forgotPassword,
);

router.post(
  '/verify-otp',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  controller.verifyOtp,
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
  controller.resetPassword,
);

router.get('/access-profile', authenticate, controller.getAccessProfile);

module.exports = router;
