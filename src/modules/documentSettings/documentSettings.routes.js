'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./documentSettings.controller');
const {
  mergeDocumentBody,
  VALID_MANDATORY,
  VALID_WHO_UPLOAD,
  VALID_VISIBILITY,
} = require('./documentSettings.service');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

const idParam = param('id').isInt({ min: 1 });

function normalizeBody(req, _res, next) {
  req.body = mergeDocumentBody(req.body || {});
  next();
}

const createValidators = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
  body('is_required').optional().isBoolean(),
  body('isRequired').optional().isBoolean(),
  body('mandatory_or_optional').optional().isIn(VALID_MANDATORY),
  body('mandatoryOrOptional').optional().isIn(VALID_MANDATORY),
  body('who_must_upload').optional().isIn(VALID_WHO_UPLOAD),
  body('whoMustUpload').optional().isIn(VALID_WHO_UPLOAD),
  body('expiry_tracking').optional().isBoolean(),
  body('expiryTracking').optional().isBoolean(),
  body('reminder_before_expiry_days').optional().isInt({ min: 1, max: 365 }),
  body('reminderBeforeExpiryDays').optional().isInt({ min: 1, max: 365 }),
  body('hr_approval_required').optional().isBoolean(),
  body('hrApprovalRequired').optional().isBoolean(),
  body('visibility').optional().isIn(VALID_VISIBILITY),
  body('sort_order').optional().isInt({ min: 0 }),
  body('sortOrder').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
];

const updateValidators = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('is_required').optional().isBoolean(),
  body('isRequired').optional().isBoolean(),
  body('mandatory_or_optional').optional().isIn(VALID_MANDATORY),
  body('mandatoryOrOptional').optional().isIn(VALID_MANDATORY),
  body('who_must_upload').optional().isIn(VALID_WHO_UPLOAD),
  body('whoMustUpload').optional().isIn(VALID_WHO_UPLOAD),
  body('expiry_tracking').optional().isBoolean(),
  body('expiryTracking').optional().isBoolean(),
  body('reminder_before_expiry_days').optional().isInt({ min: 1, max: 365 }),
  body('reminderBeforeExpiryDays').optional().isInt({ min: 1, max: 365 }),
  body('hr_approval_required').optional().isBoolean(),
  body('hrApprovalRequired').optional().isBoolean(),
  body('visibility').optional().isIn(VALID_VISIBILITY),
  body('sort_order').optional().isInt({ min: 0 }),
  body('sortOrder').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
];

router.get('/', controller.getAll);
router.get('/:id', idParam, validate, controller.getOne);

router.post('/', normalizeBody, createValidators, validate, controller.create);
router.put('/:id', idParam, normalizeBody, updateValidators, validate, controller.update);
router.delete('/:id', idParam, validate, controller.remove);

module.exports = router;
