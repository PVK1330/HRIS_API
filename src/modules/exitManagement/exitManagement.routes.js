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
const ctrl = require('./exitManagement.controller');
const v = require('./exitManagement.validator');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

/* ---- Exit Records ---- */

router.get('/', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.listingQuery, 'query'), ctrl.list);

router.get('/stats', requirePermission(P.EXIT_MANAGE), ctrl.stats);

router.get('/termination-types', requirePermission(P.EXIT_MANAGE), ctrl.terminationTypesDropdown);

router.get('/:id', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/resignation',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.createResignationBody, 'body'),
  ctrl.createResignation,
);

router.post(
  '/termination',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.createTerminationBody, 'body'),
  ctrl.createTermination,
);

router.put(
  '/:id',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateExitBody, 'body'),
  ctrl.update,
);

router.put(
  '/:id/approve',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  ctrl.approve,
);

router.put(
  '/:id/reject',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.rejectBody, 'body'),
  ctrl.reject,
);

router.put(
  '/:id/status',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.updateStatusBody, 'body'),
  ctrl.updateStatus,
);

/* ---- Clearance Tasks ---- */

router.get('/:id/clearance', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.listClearance);

router.post(
  '/:id/clearance',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.createClearanceTaskBody, 'body'),
  ctrl.addClearance,
);

router.put(
  '/:id/clearance/:taskId',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.taskIdParam, 'params'),
  validateWithJoi(v.updateClearanceTaskBody, 'body'),
  ctrl.updateClearance,
);

/* ---- Asset Returns ---- */

router.get('/:id/assets', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.listAssets);

router.post(
  '/:id/assets',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.createAssetReturnBody, 'body'),
  ctrl.addAsset,
);

router.put(
  '/:id/assets/:assetId',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.assetIdParam, 'params'),
  validateWithJoi(v.updateAssetReturnBody, 'body'),
  ctrl.updateAsset,
);

/* ---- Exit Documents ---- */

router.get('/:id/documents', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.listDocuments);

router.post(
  '/:id/documents/generate',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.generateDocumentBody, 'body'),
  ctrl.generateDocument,
);

/* ---- Exit Interviews ---- */

router.get('/:id/interview', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getInterview);

router.post(
  '/interviews',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.submitInterviewBody, 'body'),
  ctrl.submitInterview,
);

/* ---- Final Settlements ---- */

router.get('/:id/settlement', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getSettlement);

router.post(
  '/settlements',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.processSettlementBody, 'body'),
  ctrl.submitSettlement,
);

/* ---- Audit Logs ---- */

router.get('/:id/audit-log', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getAuditLog);

module.exports = router;
