'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse = require('../../../utils/ApiResponse');
const ApiError = require('../../../utils/ApiError');
const service = require('./candidatePublic.service');

const getState = asyncHandler(async (req, res) => {
  const data = await service.getByToken(req.tenant, req.params.token);
  return ApiResponse.ok(res, data, 'Onboarding state retrieved');
});

const accept = asyncHandler(async (req, res) => {
  const data = await service.acceptOffer(req.tenant, req.params.token);
  return ApiResponse.ok(res, data, data.message);
});

const reject = asyncHandler(async (req, res) => {
  const data = await service.rejectOffer(req.tenant, req.params.token, {
    reason: req.body.reason || req.body.rejectionReason,
  });
  return ApiResponse.ok(res, data, data.message);
});

const sign = asyncHandler(async (req, res) => {
  const data = await service.signOffer(req.tenant, req.params.token, {
    signatureMode: req.body.signatureMode || req.body.signature_mode,
    signatureData: req.body.signatureData || req.body.signature_data,
    typedName: req.body.typedName || req.body.typed_name,
  });
  return ApiResponse.ok(res, data, data.message);
});

const checklist = asyncHandler(async (req, res) => {
  const data = await service.listChecklist(req.tenant, req.params.token);
  return ApiResponse.ok(res, data, 'Checklist retrieved');
});

const uploadDoc = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) throw ApiError.badRequest('File is required (field: file)');
  const data = await service.uploadChecklistDocument(
    req.tenant,
    req.params.token,
    req.params.documentKey,
    req.file,
  );
  return ApiResponse.ok(res, data, data.message);
});

const downloadOffer = asyncHandler(async (req, res) => {
  const result = await service.downloadOfferPdf(
    req.tenant,
    req.params.token,
  );
  if (result.url) {
    return res.redirect(result.url);
  }
  return res.download(result.filePath, result.fileName);
});

module.exports = { getState, accept, reject, sign, checklist, uploadDoc, downloadOffer };
