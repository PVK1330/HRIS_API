'use strict';

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const env = require('../../config/env');
const {
  loadUserContext,
  loadWorkflowContext,
  resolveExitAccess,
  authorizeExitAccess,
} = require('./exitAuth.middleware');
const ctrl = require('./exitManagement.controller');
const v = require('./exitManagement.validator');

const router = Router();

// Base chain: authenticate + resolve tenant + build req.exitUser (NO scope engine).
router.use(authenticate, tenantResolver, loadUserContext);

/* Shared upload handler — files land under uploads/exit-stage-attachments/<tenant>/. */
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.resolve(env.UPLOAD.dir, 'exit-stage-attachments', req.tenant?.dbName || 'default');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

/* Per-request access chain (loads request + current stage, resolves caller capabilities). */
const reqChain = [validateWithJoi(v.idParam, 'params'), loadWorkflowContext, resolveExitAccess];

/* ---- Dashboard + lookups (no :id) ---- */
router.get('/dashboard/widgets', ctrl.widgets);
router.get('/stats', ctrl.stats);
router.get('/termination-types', ctrl.terminationTypes);

/* ---- Personal exit tasks (assigned to the caller) — registered before /:id ---- */
router.get('/tasks/mine', ctrl.myTasks);
router.put('/tasks/:taskId/complete', validateWithJoi(v.taskIdParam, 'params'), ctrl.completeTask);
router.put('/tasks/:taskId/delay-reason', validateWithJoi(v.taskIdParam, 'params'), validateWithJoi(v.taskDelayReasonBody, 'body'), ctrl.setTaskDelayReason);

/* ---- Exit requests ---- */
router.get('/', validateWithJoi(v.listingQuery, 'query'), ctrl.list);
// Optional `resignation_letter` file (scanned copy) accepted at submission — multer ignores
// non-multipart bodies, so plain-JSON submissions keep working unchanged.
router.post('/', authorizeExitAccess({ action: 'create' }), upload.single('resignation_letter'), validateWithJoi(v.createRequestBody, 'body'), ctrl.create);

router.get('/:id', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.getOne);
router.get('/:id/audit-log', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.auditLog);

/* ---- Current-stage actions ---- */
router.put('/:id/approve', ...reqChain, authorizeExitAccess({ action: 'approve' }), validateWithJoi(v.approveBody, 'body'), ctrl.approve);
router.put('/:id/reject', ...reqChain, authorizeExitAccess({ action: 'reject' }), validateWithJoi(v.rejectBody, 'body'), ctrl.reject);
router.put('/:id/send-back', ...reqChain, authorizeExitAccess({ action: 'send_back' }), validateWithJoi(v.sendBackBody, 'body'), ctrl.sendBack);
router.put('/:id/escalate', ...reqChain, authorizeExitAccess({ action: 'escalate' }), validateWithJoi(v.escalateBody, 'body'), ctrl.escalate);
router.put('/:id/reassign', ...reqChain, authorizeExitAccess({ action: 'reassign' }), validateWithJoi(v.reassignBody, 'body'), ctrl.reassign);
router.post('/:id/comment', ...reqChain, authorizeExitAccess({ action: 'comment' }), validateWithJoi(v.commentBody, 'body'), ctrl.comment);
router.post('/:id/withdraw', ...reqChain, authorizeExitAccess({ action: 'withdraw' }), validateWithJoi(v.withdrawBody, 'body'), ctrl.withdraw);

/* ---- Stage-attached checklist actions ---- */
router.get('/:id/stages/:stageId/checklist', validateWithJoi(v.stageParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'view' }), ctrl.listChecklist);
router.post('/:id/stages/:stageId/checklist', validateWithJoi(v.stageParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'complete_checklist' }), validateWithJoi(v.createChecklistBody, 'body'), ctrl.addChecklist);
router.put('/:id/stages/:stageId/checklist/:itemId', validateWithJoi(v.checklistItemParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'complete_checklist' }), validateWithJoi(v.updateChecklistBody, 'body'), ctrl.updateChecklist);

/* ---- Tasks for a specific request ---- */
router.get('/:id/tasks', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.requestTasks);

/* ---- Exit documents (relieving / experience / settlement letters) ---- */
router.get('/:id/documents/templates', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.listDocumentTemplates);
router.get('/:id/documents', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.listExitDocuments);
router.get('/:id/documents/:attachmentId/download', validateWithJoi(v.documentParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'view' }), ctrl.downloadDocument);
router.post('/:id/documents/generate', ...reqChain, authorizeExitAccess({ action: 'generate_documents' }), validateWithJoi(v.generateDocumentsBody, 'body'), ctrl.generateDocuments);

/* ---- Asset clearance (exiting employee's assigned assets) ---- */
router.get('/:id/assets', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.listAssets);
router.put('/:id/assets/:assetId/return', validateWithJoi(v.assetParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'complete_checklist' }), validateWithJoi(v.returnAssetBody, 'body'), ctrl.returnAsset);

/* ---- Attachments ---- */
router.get('/:id/attachments', ...reqChain, authorizeExitAccess({ action: 'view' }), ctrl.listAttachments);
router.post('/:id/stages/:stageId/attachments', validateWithJoi(v.stageParams, 'params'), loadWorkflowContext, resolveExitAccess, authorizeExitAccess({ action: 'upload' }), upload.single('file'), ctrl.uploadAttachment);

module.exports = router;
