'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const { requirePermission } = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const ctrl = require('./onboarding.controller');
const multer = require('multer');
const ApiError = require('../../../utils/ApiError');
const { uploadEmployeeDocument } = require('../../../middlewares/employeeDocumentUpload.middleware');
const { MIN_ONBOARDING_STEP, MAX_ONBOARDING_STEP } = require('./onboarding.workflow');

const router = Router({ mergeParams: true });

// ── Bulk export (no :id param — must come before /:id routes) ─────────────────
router.get('/onboarding/export', requirePermission(P.ONBOARDING_VIEW), ctrl.exportOnboarding);

function handleMulter(req, res, next) {
  uploadEmployeeDocument(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('File is too large'));
    }
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest(err.message || 'Upload failed'));
  });
}

router.post(
  '/:id/onboarding/notify-step',
  requirePermission(P.ONBOARDING_MANAGE),
  [
    param('id').isInt({ min: 1 }),
    // Workflow defines exactly steps 1–3; reject out-of-range so a stray high value can't be
    // persisted permanently via the GREATEST(...) write in patchOnboardingFields.
    body('step').optional().isInt({ min: MIN_ONBOARDING_STEP, max: MAX_ONBOARDING_STEP }),
  ],
  validate,
  ctrl.notifyStep,
);

router.post(
  '/:id/onboarding/send-offer-letter',
  requirePermission(P.ONBOARDING_MANAGE),
  [
    param('id').isInt({ min: 1 }),
    body('dateOfOffer').optional({ nullable: true }).isString().trim(),
    body('date_of_offer').optional({ nullable: true }).isString().trim(),
    body('offerExpiryDate').optional({ nullable: true }).isString().trim(),
    body('offer_expiry_date').optional({ nullable: true }).isString().trim(),
    body('currency').optional({ nullable: true }).isString().trim().isLength({ max: 10 }),
    body('annualCtc').optional({ nullable: true }),
    body('annual_ctc').optional({ nullable: true }),
  ],
  validate,
  ctrl.sendOffer,
);

router.patch(
  '/:id/onboarding/approval',
  requirePermission(P.ONBOARDING_MANAGE),
  [
    param('id').isInt({ min: 1 }),
    body('status').exists().isString().trim().isLength({ min: 1, max: 32 }),
    body('rejectionReason').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body('rejection_reason').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  ],
  validate,
  ctrl.approval,
);

router.get(
  '/:id/onboarding/checklist',
  requirePermission(P.ONBOARDING_VIEW),
  [param('id').isInt({ min: 1 })],
  validate,
  ctrl.getChecklist,
);

router.patch(
  '/:id/onboarding/checklist/:itemId/review',
  requirePermission(P.ONBOARDING_MANAGE),
  [
    param('id').isInt({ min: 1 }),
    param('itemId').isInt({ min: 1 }),
    body('hrReviewStatus').exists().isString().trim(),
    body('hr_review_status').optional().isString().trim(),
    body('hrReviewComment').optional({ nullable: true }).isString().trim(),
    body('hr_review_comment').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  ctrl.reviewChecklist,
);

router.post(
  '/:id/onboarding/signed-offer',
  requirePermission(P.ONBOARDING_MANAGE),
  [param('id').isInt({ min: 1 })],
  validate,
  handleMulter,
  ctrl.uploadSignedOffer,
);

router.post(
  '/:id/onboarding/complete',
  requirePermission(P.ONBOARDING_MANAGE),
  [param('id').isInt({ min: 1 })],
  validate,
  ctrl.completeWorkflow,
);

router.post(
  '/:id/onboarding/remind-documents',
  requirePermission(P.ONBOARDING_MANAGE),
  [param('id').isInt({ min: 1 })],
  validate,
  ctrl.remindDocuments,
);

module.exports = router;
