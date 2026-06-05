'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./currency.controller');

const router = Router();

const THOUSAND_SEPARATORS = ['.', ',', ' ', "'", ''];

// Any authenticated user can read currency display/conversion/tax settings so
// the whole app can format & auto-convert money consistently.
router.get('/display', authenticate, controller.getPublicCurrencySettings);

// Everything below is superadmin-only (full read + write).
router.use(authenticate, requireRole('superadmin'));

const updateValidators = [
  body('defaultCurrency')
    .notEmpty()
    .withMessage('defaultCurrency is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 10 })
    .withMessage('defaultCurrency must be 1-10 characters'),
  body('currencySymbol')
    .notEmpty()
    .withMessage('currencySymbol is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 5 })
    .withMessage('currencySymbol must be 1-5 characters'),
  body('symbolPosition')
    .isIn(['before', 'after', 'before-space', 'after-space'])
    .withMessage('symbolPosition must be before, after, before-space or after-space'),
  body('decimalSeparator')
    .isIn(['.', ','])
    .withMessage('decimalSeparator must be . or ,'),
  body('thousandSeparator')
    .exists()
    .withMessage('thousandSeparator is required')
    .custom((value) => THOUSAND_SEPARATORS.includes(value))
    .withMessage('thousandSeparator must be . , space, apostrophe, or empty'),
  body('decimalPlaces').optional().isInt({ min: 0, max: 4 }),
  body('taxEnabled').optional().isBoolean(),
  body('taxLabel').optional().isString().trim().isLength({ max: 20 }),
  body('taxRate').optional().isFloat({ min: 0, max: 100 }),
  // exchangeRates are market-driven and ignored if sent.
];

router.get('/', controller.getCurrencySettings);

router.put('/', updateValidators, validate, controller.updateCurrencySettings);

// Pull fresh market rates on demand.
router.post('/refresh-rates', controller.refreshExchangeRates);

module.exports = router;
