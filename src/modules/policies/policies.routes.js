'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadFile } = require('../../middlewares/upload.middleware');
const ctrl = require('./policies.controller');

const router = Router();

router.use(authenticate);
router.use(tenantResolver);
router.use(loadAuthContext);

router.get('/categories', requirePermission(P.POLICIES_MANAGE), ctrl.listCategories);
router.post('/categories', requirePermission(P.POLICIES_MANAGE), ctrl.createCategory);
router.patch('/categories/:id', requirePermission(P.POLICIES_MANAGE), ctrl.updateCategory);
router.delete('/categories/:id', requirePermission(P.POLICIES_MANAGE), ctrl.deleteCategory);

router.get('/', requirePermission(P.POLICIES_MANAGE), ctrl.list);
router.post('/', [
  requirePermission(P.POLICIES_MANAGE),
  body('title').notEmpty().withMessage('Title is required').trim(),
  body('category').notEmpty().withMessage('Category is required').trim(),
], validate, ctrl.create);

router.post('/upload', uploadFile('file', 'policy'), ctrl.uploadFile);

router.get('/:id', requirePermission(P.POLICIES_MANAGE), [
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.getOne);

router.get('/:id/tracking', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.getTracking);

router.post('/:id/acknowledge', [
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.acknowledge);

router.patch('/:id', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.update);

router.delete('/:id', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.remove);

module.exports = router;
