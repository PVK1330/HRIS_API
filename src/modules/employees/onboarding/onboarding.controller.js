'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse = require('../../../utils/ApiResponse');
const service = require('./onboarding.service');

const notifyStep = asyncHandler(async (req, res) => {
  const step = parseInt(req.body.step, 10) || 1;
  const result = await service.notifyStepCompleted(
    req.user,
    req.params.id,
    { step },
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const approval = asyncHandler(async (req, res) => {
  const result = await service.setApprovalStatus(
    req.user,
    req.params.id,
    {
      status: req.body.status,
      rejectionReason: req.body.rejectionReason ?? req.body.rejection_reason,
    },
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const sendOffer = asyncHandler(async (req, res) => {
  const result = await service.sendOfferLetter(
    req.user,
    req.params.id,
    {
      dateOfOffer: req.body.dateOfOffer ?? req.body.date_of_offer,
      offerExpiryDate: req.body.offerExpiryDate ?? req.body.offer_expiry_date,
      currency: req.body.currency,
      annualCtc: req.body.annualCtc ?? req.body.annual_ctc,
    },
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const getChecklist = asyncHandler(async (req, res) => {
  const result = await service.getOnboardingChecklist(
    req.user,
    req.params.id,
    req.auth,
  );
  return ApiResponse.ok(res, result, 'Checklist retrieved');
});

const reviewChecklist = asyncHandler(async (req, res) => {
  const result = await service.reviewChecklistItem(
    req.user,
    req.params.id,
    req.params.itemId,
    {
      hrReviewStatus: req.body.hrReviewStatus ?? req.body.hr_review_status,
      hrReviewComment: req.body.hrReviewComment ?? req.body.hr_review_comment,
    },
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const completeWorkflow = asyncHandler(async (req, res) => {
  const result = await service.completeOnboardingWorkflow(
    req.user,
    req.params.id,
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const uploadSignedOffer = asyncHandler(async (req, res) => {
  const result = await service.uploadSignedOfferByHr(
    req.user,
    req.params.id,
    req.file,
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const remindDocuments = asyncHandler(async (req, res) => {
  const result = await service.sendPendingDocumentReminder(
    req.user,
    req.params.id,
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const exportOnboarding = asyncHandler(async (req, res) => {
  const { getBranding } = require('../../../utils/exportBranding');
  const exportLib = require('./onboarding.export');
  const type = (req.query.type || 'excel').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  const [rows, branding] = await Promise.all([
    service.listAllForExport(req.user, req.query),
    getBranding({ db_name: req.user.db_name }),
  ]);

  if (type === 'pdf') {
    res.setHeader('Content-Disposition', `attachment; filename="onboarding_${today}.pdf"`);
    exportLib.buildPDF(res, rows, branding);
    return undefined;
  }
  res.setHeader('Content-Disposition', `attachment; filename="onboarding_${today}.xlsx"`);
  await exportLib.buildExcel(res, rows, branding);
  res.end();
});

module.exports = {
  notifyStep,
  approval,
  sendOffer,
  getChecklist,
  reviewChecklist,
  completeWorkflow,
  uploadSignedOffer,
  remindDocuments,
  exportOnboarding,
};
