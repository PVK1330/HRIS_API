'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const { authenticate, requirePermission, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const validate = require('../../middlewares/validate.middleware');
const ApiError = require('../../utils/ApiError');
const controller = require('./assetSettings.controller');
const { P } = require('../../constants/permissions');
const {
  mergeFlatRulesBody,
  VALID_ASSIGNING_RULES,
  VALID_RETURN_RULES,
  VALID_LOST_DAMAGED_POLICIES,
  VALID_APPROVAL_WORKFLOWS,
} = require('./assetSettings.service');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

const categoryIdParam = param('id')
  .isInt({ min: 1 })
  .toInt()
  .withMessage('Invalid category id');

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

router.get('/categories', requirePermission(P.ASSETS_VIEW), controller.getCategories);
router.post('/categories', requirePermission(P.ASSETS_CREATE), createCategoryValidators, validate, controller.createCategory);
router.put(
  '/categories/:id',
  requirePermission(P.ASSETS_EDIT),
  categoryIdParam,
  updateCategoryValidators,
  validate,
  controller.updateCategory
);
router.delete('/categories/:id', requirePermission(P.ASSETS_DELETE), categoryIdParam, validate, controller.deleteCategory);

router.get('/rules', requirePermission(P.ASSETS_VIEW), controller.getAssetRules);
router.put(
  '/rules',
  requirePermission(P.ASSETS_EDIT),
  normalizeRulesBody,
  updateRulesValidators,
  validate,
  controller.updateAssetRules
);

module.exports = router;
