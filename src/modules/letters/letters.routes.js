'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const validate  = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./letters.controller');

const router = Router();

// All routes require a logged-in tenant admin
router.use(authenticate, requireRole('admin', 'hr_admin', 'hr_executive', 'manager'));

// ─── KPIs ─────────────────────────────────────────────────────────────────────
router.get('/kpis', controller.getKpis);

// ─── Templates ────────────────────────────────────────────────────────────────
router.get('/templates', controller.listTemplates);

router.get(
  '/templates/:id',
  [param('id').isInt({ min: 1 }).withMessage('id must be a positive integer')],
  validate,
  controller.getTemplate
);

router.post(
  '/templates',
  [
    body('name')
      .exists({ checkFalsy: true }).withMessage('name is required').bail()
      .isString().trim()
      .isLength({ min: 2, max: 255 }).withMessage('name must be 2–255 characters'),
    body('type')
      .optional()
      .isIn(['Letter', 'Form', 'Certificate', 'Report'])
      .withMessage('type must be one of: Letter, Form, Certificate, Report'),
    body('category')
      .exists({ checkFalsy: true }).withMessage('category is required').bail()
      .isString().trim()
      .isIn(['Recruitment', 'Compliance', 'Performance', 'Exit', 'HR', 'Finance', 'Leave', 'Disciplinary'])
      .withMessage('invalid category'),
    body('description')
      .optional()
      .isString().withMessage('description must be a string'),
    body('body')
      .optional()
      .isString().withMessage('body must be a string'),
    body('status')
      .optional()
      .isIn(['Active', 'Draft']).withMessage('status must be Active or Draft'),
  ],
  validate,
  controller.createTemplate
);

router.patch(
  '/templates/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    body('name')
      .optional()
      .isString().trim()
      .isLength({ min: 2, max: 255 }).withMessage('name must be 2–255 characters'),
    body('type')
      .optional()
      .isIn(['Letter', 'Form', 'Certificate', 'Report'])
      .withMessage('type must be one of: Letter, Form, Certificate, Report'),
    body('category')
      .optional()
      .isString().trim()
      .isIn(['Recruitment', 'Compliance', 'Performance', 'Exit', 'HR', 'Finance', 'Leave', 'Disciplinary'])
      .withMessage('invalid category'),
    body('description')
      .optional()
      .isString().withMessage('description must be a string'),
    body('body')
      .optional()
      .isString().withMessage('body must be a string'),
    body('status')
      .optional()
      .isIn(['Active', 'Draft']).withMessage('status must be Active or Draft'),
  ],
  validate,
  controller.updateTemplate
);

router.delete(
  '/templates/:id',
  [param('id').isInt({ min: 1 }).withMessage('id must be a positive integer')],
  validate,
  controller.deleteTemplate
);

// ─── Dispatch ─────────────────────────────────────────────────────────────────
router.post(
  '/dispatch',
  [
    body('templateId')
      .exists({ checkFalsy: true }).withMessage('templateId is required').bail()
      .isInt({ min: 1 }).withMessage('templateId must be a positive integer'),
    body('employeeId')
      .optional({ nullable: true })
      .isInt({ min: 1 }).withMessage('employeeId must be a positive integer'),
    body('sentBy')
      .optional()
      .isString().trim()
      .isLength({ max: 255 }).withMessage('sentBy must be at most 255 characters'),
  ],
  validate,
  controller.dispatchLetter
);

// ─── History ──────────────────────────────────────────────────────────────────
router.get('/history', controller.listHistory);

// ─── Tags ─────────────────────────────────────────────────────────────────────
router.get('/tags', controller.listTags);

router.post(
  '/tags',
  [
    body('tag')
      .exists({ checkFalsy: true }).withMessage('tag is required').bail()
      .isString().trim()
      .isLength({ min: 1, max: 100 }).withMessage('tag must be 1–100 characters'),
    body('description')
      .optional()
      .isString().trim()
      .isLength({ max: 255 }).withMessage('description must be at most 255 characters'),
  ],
  validate,
  controller.createTag
);

router.patch(
  '/tags/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    body('tag')
      .optional()
      .isString().trim()
      .isLength({ min: 1, max: 100 }).withMessage('tag must be 1–100 characters'),
    body('description')
      .optional()
      .isString().trim()
      .isLength({ max: 255 }).withMessage('description must be at most 255 characters'),
  ],
  validate,
  controller.updateTag
);

router.delete(
  '/tags/:id',
  [param('id').isInt({ min: 1 }).withMessage('id must be a positive integer')],
  validate,
  controller.deleteTag
);

module.exports = router;
