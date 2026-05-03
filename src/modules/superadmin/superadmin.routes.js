'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const controller = require('./superadmin.controller');

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

module.exports = router;
