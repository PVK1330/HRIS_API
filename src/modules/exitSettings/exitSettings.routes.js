'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ctrl = require('./exitSettings.controller');
const v = require('./exitSettings.validator');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

/* Exit workflow config: pipeline stages + department approval sequence */
router.get(
  '/exit-workflow-config',
  requirePermission(P.EXIT_MANAGE),
  ctrl.getWorkflowConfig,
);
router.put(
  '/exit-workflow-config',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.saveExitWorkflowConfigBody, 'body'),
  ctrl.saveWorkflowConfig,
);

router.get(
  '/pipeline-stages',
  requirePermission(P.EXIT_MANAGE),
  ctrl.getPipelineStages,
);
router.put(
  '/pipeline-stages',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.savePipelineStagesBody, 'body'),
  ctrl.savePipelineStages,
);

router.get(
  '/department-workflow-template',
  requirePermission(P.EXIT_MANAGE),
  ctrl.getOrgWorkflow,
);
router.put(
  '/department-workflow-template',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.saveOrgWorkflowBody, 'body'),
  ctrl.saveOrgWorkflow,
);

/* Clearance Task Templates (must come before /:id to avoid param capture) */
router.get('/clearance-templates/list', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.listClearance);
router.get('/clearance-templates/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getClearance);
router.post('/clearance-templates', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.createClearanceBody, 'body'), ctrl.createClearance);
router.put('/clearance-templates/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), validateWithJoi(v.updateClearanceBody, 'body'), ctrl.updateClearance);
router.delete('/clearance-templates/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.removeClearance);

/* Termination Types */
router.get('/', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.list);
router.get('/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getOne);
router.post(
  '/',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);
router.put(
  '/:id',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);
router.delete('/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
