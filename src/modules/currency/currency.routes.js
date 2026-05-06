'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./currency.controller');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

const THOUSAND_SEPARATORS = ['.', ',', ' ', ''];

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
    .isIn(['before', 'after'])
    .withMessage('symbolPosition must be before or after'),
  body('decimalSeparator')
    .isIn(['.', ','])
    .withMessage('decimalSeparator must be . or ,'),
  body('thousandSeparator')
    .exists()
    .withMessage('thousandSeparator is required')
    .custom((value) => THOUSAND_SEPARATORS.includes(value))
    .withMessage('thousandSeparator must be . , space, or empty'),
];

router.get('/', controller.getCurrencySettings);

router.put('/', updateValidators, validate, controller.updateCurrencySettings);

module.exports = router;
