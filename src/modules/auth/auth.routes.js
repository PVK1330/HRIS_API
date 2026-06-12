'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const controller = require('./auth.controller');
const { authLimiter, otpLimiter, refreshLimiter } = require('../../middlewares/rateLimit.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');
const { verifyRecaptcha } = require('../../middlewares/recaptcha.middleware');

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
  verifyRecaptcha,
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
  otpLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  controller.verifyOtp,
);

router.post(
  '/reset-password',
  otpLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('newPassword').notEmpty().withMessage('New password is required'),
  ],
  validate,
  controller.resetPassword,
);

router.post(
  '/verify-2fa',
  authLimiter,
  [
    body('mfaToken').notEmpty().withMessage('Verification session token is required'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits'),
  ],
  validate,
  controller.verifyTwoFactor,
);

/* --- Authenticated self-service password change --- */
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').notEmpty().withMessage('New password is required'),
  ],
  validate,
  controller.changePassword,
);

router.get('/access-profile', authenticate, controller.getAccessProfile);

/* --- Self-service profile (tenant admin / hr / employee + superadmin) --- */
router.get('/me', authenticate, controller.getMe);
router.put(
  '/me',
  authenticate,
  [
    body('name')
      .optional()
      .isString().withMessage('name must be a string')
      .trim()
      .isLength({ min: 1 }).withMessage('name must not be empty'),
  ],
  validate,
  controller.updateMe,
);

router.post(
  '/exchange-impersonation-code',
  authLimiter,
  [
    body('code')
      .isString().withMessage('code must be a string')
      .isLength({ min: 64, max: 64 }).withMessage('Invalid code format'),
  ],
  validate,
  controller.exchangeImpersonationCode,
);

router.post('/refresh', refreshLimiter, controller.refresh);
router.post('/logout', controller.logout);

/* --- Self-service MFA enrollment --- */
router.get('/mfa/status', authenticate, controller.getMfaStatus);
router.post('/mfa/setup', authenticate, controller.setupMfa);
router.post(
  '/mfa/enable',
  authenticate,
  [body('code').isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits')],
  validate,
  controller.enableMfa,
);
router.post(
  '/mfa/disable',
  authenticate,
  [body('code').optional().isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits')],
  validate,
  controller.disableMfa,
);

module.exports = router;
