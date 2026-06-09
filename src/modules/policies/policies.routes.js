'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ApiError = require('../../utils/ApiError');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadPolicyFile } = require('../../middlewares/upload.middleware');
const ctrl = require('./policies.controller');

const router = Router();

/** Portal employees and users with policies.view / acknowledge / manage */
function requirePolicyPortalAccess(req, res, next) {
  const { user } = req;
  if (!user) return next(ApiError.unauthorized('Authentication required'));
  if (user.role === 'admin' || user.role === 'superadmin') return next();
  if (user.role === 'employee') return next();
  return requireAnyPermission(
    P.POLICIES_VIEW,
    P.POLICIES_ACKNOWLEDGE,
    P.POLICIES_MANAGE,
  )(req, res, next);
}

router.use(authenticate);
router.use(tenantResolver);
router.use(loadAuthContext);

router.get('/categories', requirePermission(P.POLICIES_MANAGE), ctrl.listCategories);
router.post('/categories', requirePermission(P.POLICIES_MANAGE), ctrl.createCategory);
router.patch('/categories/:id', requirePermission(P.POLICIES_MANAGE), ctrl.updateCategory);
router.delete('/categories/:id', requirePermission(P.POLICIES_MANAGE), ctrl.deleteCategory);

router.get('/me', requirePolicyPortalAccess, ctrl.listMine);
router.get(
  '/me/:id',
  requirePolicyPortalAccess,
  [param('id').isInt().withMessage('ID must be an integer')],
  validate,
  ctrl.getMine,
);

// Archived (soft-deleted) policies — admin read-only. Declared BEFORE '/:id' so
// the literal '/archived' segment isn't captured by the :id param.
router.get('/archived', requirePermission(P.POLICIES_MANAGE), ctrl.listArchived);
router.get('/archived/:id', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.getArchived);
router.get('/archived/:id/tracking', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.getArchivedTracking);

router.get('/', requirePermission(P.POLICIES_MANAGE), ctrl.list);
router.post('/', [
  requirePermission(P.POLICIES_MANAGE),
  body('title').notEmpty().withMessage('Title is required').trim(),
  body('category').notEmpty().withMessage('Category is required').trim(),
], validate, ctrl.create);

router.post('/upload', requirePermission(P.POLICIES_MANAGE), uploadPolicyFile('file'), ctrl.uploadFile);

router.get('/:id', requirePermission(P.POLICIES_MANAGE), [
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.getOne);

router.get('/:id/tracking', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.getTracking);

router.post('/:id/acknowledge', [
  requirePolicyPortalAccess,
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.acknowledge);

router.patch('/:id', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.update);

router.delete('/:id', [
  requirePermission(P.POLICIES_MANAGE),
  param('id').isInt().withMessage('ID must be an integer'),
], validate, ctrl.remove);

module.exports = router;
