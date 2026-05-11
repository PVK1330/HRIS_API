'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole, requirePermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadFile } = require('../../middlewares/upload.middleware');
const ctrl = require('./policies.controller');

const router = Router();

router.use(authenticate);
router.use(tenantResolver);

router.get('/categories', ctrl.listCategories);
router.post('/categories', [requirePermission('policies')], ctrl.createCategory);
router.patch('/categories/:id', [requirePermission('policies')], ctrl.updateCategory);
router.delete('/categories/:id', [requirePermission('policies')], ctrl.deleteCategory);

router.get('/', ctrl.list);
router.post('/', [
  requirePermission('policies'),
  body('title').notEmpty().withMessage('Title is required').trim(),
  body('category').notEmpty().withMessage('Category is required').trim(),
], validate, ctrl.create);

router.post('/upload', uploadFile('file', 'policy'), ctrl.uploadFile);

router.get('/:id', [
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.getOne);

router.get('/:id/tracking', [
  requirePermission('policies'),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.getTracking);

router.post('/:id/acknowledge', [
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.acknowledge);

router.post('/', [
  requirePermission('policies'),
  body('title').notEmpty().withMessage('Title is required').trim(),
  body('category').notEmpty().withMessage('Category is required').trim(),
], validate, ctrl.create);

router.patch('/:id', [
  requirePermission('policies'),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.update);

router.delete('/:id', [
  requirePermission('policies'),
  param('id').isInt().withMessage('ID must be an integer')
], validate, ctrl.remove);

module.exports = router;
