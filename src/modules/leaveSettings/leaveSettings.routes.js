'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./leaveSettings.controller');
const { mergeLeaveBody, VALID_PAID_UNPAID, VALID_ACCRUAL, VALID_LOP_RULES } =
  require('./leaveSettings.service');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

const uuidParam = param('id').isUUID();

function normalizeBody(req, _res, next) {
  req.body = mergeLeaveBody(req.body || {});
  next();
}

const createValidators = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
  body('paid_or_unpaid').optional().isIn(VALID_PAID_UNPAID),
  body('paidOrUnpaid').optional().isIn(VALID_PAID_UNPAID),
  body('accrual').optional().isIn(VALID_ACCRUAL),
  body('loss_of_pay_rule').optional().isIn(VALID_LOP_RULES),
  body('lossOfPayRule').optional().isIn(VALID_LOP_RULES),
  body('annual_entitlement_days').optional().isInt({ min: 0, max: 365 }),
  body('annualEntitlementDays').optional().isInt({ min: 0, max: 365 }),
  body('max_carry_forward_days').optional().isInt({ min: 0, max: 365 }),
  body('maxCarryForwardDays').optional().isInt({ min: 0, max: 365 }),
  body('document_required').optional().isBoolean(),
  body('documentRequired').optional().isBoolean(),
  body('auto_approval').optional().isBoolean(),
  body('autoApproval').optional().isBoolean(),
  body('entitlement_label').optional().isLength({ max: 30 }),
  body('entitlementLabel').optional().isLength({ max: 30 }),
  body('approver').optional().isString().trim().isLength({ min: 1, max: 30 }),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
];

const updateValidators = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  ...createValidators.slice(1),
];

router.get('/', controller.getAll);
router.get('/:id', uuidParam, validate, controller.getOne);

router.post('/', normalizeBody, createValidators, validate, controller.create);
router.put('/:id', uuidParam, normalizeBody, updateValidators, validate, controller.update);
router.delete('/:id', uuidParam, validate, controller.remove);

module.exports = router;
