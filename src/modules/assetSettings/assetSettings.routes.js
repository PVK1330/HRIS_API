'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./assetSettings.controller');
const {
  mergeFlatRulesBody,
  VALID_ASSIGNING_RULES,
  VALID_RETURN_RULES,
  VALID_LOST_DAMAGED_POLICIES,
  VALID_APPROVAL_WORKFLOWS,
} = require('./assetSettings.service');

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Access denied. Admin role required.'));
  }
  next();
};

router.use(authenticate, tenantResolver, adminOnly);

const uuidParam = param('id').isUUID().withMessage('Invalid category id');

const createCategoryValidators = [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
  body('icon').optional().isLength({ max: 50 }),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('sortOrder').optional().isInt({ min: 0 }),
  body('sort_order').optional().isInt({ min: 0 }),
];

const updateCategoryValidators = [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('icon').optional().isLength({ max: 50 }),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('sortOrder').optional().isInt({ min: 0 }),
  body('sort_order').optional().isInt({ min: 0 }),
  body('isActive').optional().isBoolean(),
  body('is_active').optional().isBoolean(),
];

function normalizeRulesBody(req, _res, next) {
  req.body = mergeFlatRulesBody(req.body || {});
  next();
}

const updateRulesValidators = [
  body('assigning_rule').optional().isIn(VALID_ASSIGNING_RULES),
  body('return_rule').optional().isIn(VALID_RETURN_RULES),
  body('lost_damaged_policy').optional().isIn(VALID_LOST_DAMAGED_POLICIES),
  body('approval_workflow').optional().isIn(VALID_APPROVAL_WORKFLOWS),
];

router.get('/categories', controller.getCategories);
router.post('/categories', createCategoryValidators, validate, controller.createCategory);
router.put(
  '/categories/:id',
  uuidParam,
  updateCategoryValidators,
  validate,
  controller.updateCategory
);
router.delete('/categories/:id', uuidParam, validate, controller.deleteCategory);

router.get('/rules', controller.getAssetRules);
router.put(
  '/rules',
  normalizeRulesBody,
  updateRulesValidators,
  validate,
  controller.updateAssetRules
);

module.exports = router;
