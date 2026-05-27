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

/* ---- Resignation Withdrawal ---- */

router.post(
  '/:id/withdraw',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.submitWithdrawalBody, 'body'),
  ctrl.withdrawResignation,
);

router.put(
  '/:id/withdraw/approve',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  ctrl.approveWithdrawal,
);

router.put(
  '/:id/withdraw/reject',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  validateWithJoi(v.rejectWithdrawalBody, 'body'),
  ctrl.rejectWithdrawal,
);

/* ---- Clearance Documents Upload ---- */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../../config/env');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const tenantDb = req.tenant?.dbName || 'default';
    const dir = path.resolve(env.UPLOAD.dir, 'clearance-documents', tenantDb);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${Date.now()}-${basename}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.post(
  '/:id/clearance/:taskId/upload',
  requirePermission(P.EXIT_MANAGE),
  validateWithJoi(v.taskIdParam, 'params'),
  upload.single('file'),
  ctrl.uploadClearanceProof,
);

/* ---- Audit Logs ---- */

router.get('/:id/audit-log', requirePermission(P.EXIT_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.getAuditLog);

module.exports = router;
