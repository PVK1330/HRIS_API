'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { uploadLogo } = require('../../middlewares/upload.middleware');
const controller = require('./settings.controller');

const router = Router();

/**
 * Settings module routes.
 * All endpoints require an authenticated SuperAdmin.
 */
router.use(authenticate, requireRole('superadmin'));

/* -------------------- Validators -------------------- */

const VALID_TIMEZONES = [
  'UTC',
  'GMT',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Bangkok',
  'Australia/Sydney', 'Australia/Melbourne',
  'Africa/Cairo', 'Africa/Johannesburg',
  'Pacific/Auckland',
];

const generalValidators = [
  body('defaultLanguage').optional().isString().trim().isLength({ min: 1, max: 50 }),
  body('timezone').optional().isString().isIn(VALID_TIMEZONES)
    .withMessage(`timezone must be one of: ${VALID_TIMEZONES.join(', ')}`),
  body('dateFormat').optional().isString().trim().isLength({ min: 1, max: 30 }),
  body('dateSelectorFormat').optional().isString().trim().isLength({ min: 1, max: 30 }),
  body('renewalGracePeriod').optional()
    .customSanitizer((v) => (v === '' || v === null ? undefined : v))
    .isInt({ min: 1, max: 30 }).withMessage('renewalGracePeriod must be 1-30')
    .toInt(),
  body('termsOfService').optional()
    .customSanitizer((v) => {
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v).toLowerCase();
    })
    .isIn(['true', 'false']).withMessage('termsOfService must be boolean'),
];

const companyValidators = [
  body('companyName').optional().isString().trim().isLength({ max: 255 }),
  body('address').optional().isString().trim().isLength({ max: 500 }),
  body('city').optional().isString().trim().isLength({ max: 100 }),
  body('state').optional().isString().trim().isLength({ max: 100 }),
  body('zip').optional().isString().trim().isLength({ max: 20 }),
  body('country').optional().isString().trim().isLength({ max: 100 }),
  body('telephone').optional().isString().trim().isLength({ max: 50 }),
];

const emailValidators = [
  body('systemEmail').optional({ checkFalsy: false })
    .if((value) => value !== undefined && value !== '')
    .isEmail().withMessage('systemEmail must be a valid email')
    .normalizeEmail(),
  body('systemFromName').optional().isString().trim().isLength({ max: 100 }),
  body('emailDelivery').optional().isString().isIn(['smtp'])
    .withMessage('emailDelivery must be one of: smtp'),
  body('smtpHost').optional().isString().trim().isLength({ max: 255 }),
  body('smtpPort').optional()
    .customSanitizer((v) => (v === '' || v === null ? undefined : v))
    .isInt({ min: 1, max: 65535 }).withMessage('smtpPort must be between 1 and 65535')
    .toInt(),
  body('smtpUsername').optional().isString().trim().isLength({ max: 255 }),
  body('smtpPassword').optional().isString().isLength({ max: 255 }),
  body('smtpEncryption').optional().isString()
    .isIn(['tls', 'ssl', 'none']).withMessage('smtpEncryption must be one of: tls, ssl, none'),
];

const testEmailValidators = [
  body('sendTo').exists({ checkFalsy: true }).withMessage('sendTo is required').bail()
    .isEmail().withMessage('sendTo must be a valid email').normalizeEmail(),
];

const templateUpdateValidators = [
  param('slug').isString().trim().isLength({ min: 1, max: 100 }),
  body('subject').optional().isString().trim().isLength({ min: 1, max: 255 }),
  body('body').optional().isString().isLength({ min: 1 }),
  body('isActive').optional().isBoolean().toBoolean(),
];

/* -------------------- General Settings -------------------- */

router.get('/general', controller.getGeneralSettings);
router.put('/general', generalValidators, validate, controller.updateGeneralSettings);

/* -------------------- Company Details -------------------- */

router.get('/company', controller.getCompanySettings);
router.put('/company', companyValidators, validate, controller.updateCompanySettings);

/* -------------------- Email Settings -------------------- */

router.get('/email', controller.getEmailSettings);
router.put('/email', emailValidators, validate, controller.updateEmailSettings);
router.post('/email/test', testEmailValidators, validate, controller.sendTestEmail);

/* -------------------- Email Templates -------------------- */

router.get('/email/templates', controller.listEmailTemplates);
router.get('/email/templates/:slug',
  [param('slug').isString().trim().isLength({ min: 1, max: 100 })],
  validate,
  controller.getEmailTemplate
);
router.put('/email/templates/:slug',
  templateUpdateValidators,
  validate,
  controller.updateEmailTemplate
);

/* -------------------- Logo Upload -------------------- */

router.post('/logo/large',   uploadLogo('large'),   controller.uploadLargeLogo);
router.post('/logo/small',   uploadLogo('small'),   controller.uploadSmallLogo);
router.post('/logo/favicon', uploadLogo('favicon'), controller.uploadFavicon);
router.get('/logo', controller.getLogos);

/* -------------------- System Info -------------------- */

router.get('/system', controller.getSystemInfo);

module.exports = router;
