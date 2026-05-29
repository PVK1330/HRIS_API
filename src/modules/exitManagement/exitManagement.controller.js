'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./exitManagement.service');
const exitSettingsService = require('../exitSettings/exitSettings.service');

const list = asyncHandler(async (req, res) => {
  const result = await service.listExitRecords(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Exit records retrieved successfully');
});

const stats = asyncHandler(async (req, res) => {
  const data = await service.getExitStats(req.tenant);
  return ApiResponse.ok(res, data, 'Exit stats retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const record = await service.getExitRecord(req.tenant, req.params.id);
  return ApiResponse.ok(res, record, 'Exit record retrieved successfully');
});

const createResignation = asyncHandler(async (req, res) => {
  const record = await service.createResignation(req.tenant, req.body, req.user?.id);
  return ApiResponse.created(res, record, 'Resignation created successfully');
});

const createTermination = asyncHandler(async (req, res) => {
  const record = await service.createTermination(req.tenant, req.body, req.user?.id);
  return ApiResponse.created(res, record, 'Termination record created successfully');
});

const update = asyncHandler(async (req, res) => {
  const record = await service.updateExitRecord(req.tenant, req.params.id, req.body, req.user?.id);
  return ApiResponse.ok(res, record, 'Exit record updated successfully');
});

const approve = asyncHandler(async (req, res) => {
  const record = await service.approveResignation(req.tenant, req.params.id, req.user?.id);
  return ApiResponse.ok(res, record, 'Resignation approved successfully');
});

const reject = asyncHandler(async (req, res) => {
  const record = await service.rejectResignation(
    req.tenant, req.params.id, req.body.rejection_reason, req.user?.id,
  );
  return ApiResponse.ok(res, record, 'Resignation rejected successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
  const record = await service.updateExitStatus(
    req.tenant, req.params.id, req.body.status, req.user?.id,
  );
  return ApiResponse.ok(res, record, 'Exit status updated successfully');
});

const listClearance = asyncHandler(async (req, res) => {
  const tasks = await service.listClearanceTasks(req.tenant, req.params.id);
  return ApiResponse.ok(res, tasks, 'Clearance tasks retrieved successfully');
});

const addClearance = asyncHandler(async (req, res) => {
  const task = await service.addClearanceTask(req.tenant, req.params.id, req.body);
  return ApiResponse.created(res, task, 'Clearance task added successfully');
});

const updateClearance = asyncHandler(async (req, res) => {
  const task = await service.updateClearanceTask(
    req.tenant, req.params.id, req.params.taskId, req.body, req.user?.id,
  );
  return ApiResponse.ok(res, task, 'Clearance task updated successfully');
});

const listAssets = asyncHandler(async (req, res) => {
  const items = await service.listAssetReturns(req.tenant, req.params.id);
  return ApiResponse.ok(res, items, 'Asset returns retrieved successfully');
});

const addAsset = asyncHandler(async (req, res) => {
  const item = await service.addAssetReturn(req.tenant, req.params.id, req.body);
  return ApiResponse.created(res, item, 'Asset return added successfully');
});

const updateAsset = asyncHandler(async (req, res) => {
  const item = await service.updateAssetReturn(
    req.tenant, req.params.id, req.params.assetId, req.body, req.user?.id,
  );
  return ApiResponse.ok(res, item, 'Asset return updated successfully');
});

const listDocuments = asyncHandler(async (req, res) => {
  const docs = await service.listExitDocuments(req.tenant, req.params.id);
  return ApiResponse.ok(res, docs, 'Exit documents retrieved successfully');
});

const generateDocument = asyncHandler(async (req, res) => {
  const doc = await service.generateExitDocument(req.tenant, req.params.id, req.body, req.user?.id);
  return ApiResponse.created(res, doc, 'Exit document generated successfully');
});

const terminationTypesDropdown = asyncHandler(async (req, res) => {
  const types = await service.getActiveTerminationTypes(req.tenant);
  return ApiResponse.ok(res, types, 'Termination types retrieved successfully');
});

const submitInterview = asyncHandler(async (req, res) => {
  const interview = await service.submitExitInterview(req.tenant, req.body, req.user?.id);
  return ApiResponse.created(res, interview, 'Exit interview submitted successfully');
});

const getInterview = asyncHandler(async (req, res) => {
  const interview = await service.getExitInterview(req.tenant, req.params.id);
  return ApiResponse.ok(res, interview, 'Exit interview retrieved');
});

const submitSettlement = asyncHandler(async (req, res) => {
  const settlement = await service.processSettlement(req.tenant, req.body, req.user?.id);
  return ApiResponse.created(res, settlement, 'Settlement processed successfully');
});

const getSettlement = asyncHandler(async (req, res) => {
  const settlement = await service.getSettlement(req.tenant, req.params.id);
  return ApiResponse.ok(res, settlement, 'Settlement retrieved');
});

const getAuditLog = asyncHandler(async (req, res) => {
  const logs = await service.getAuditLog(req.tenant, req.params.id);
  return ApiResponse.ok(res, logs, 'Audit logs retrieved');
});

const withdrawResignation = asyncHandler(async (req, res) => {
  const record = await service.requestResignationWithdrawal(
    req.tenant, req.params.id, req.body, req.user?.id
  );
  return ApiResponse.ok(res, record, 'Resignation withdrawal requested successfully');
});

const approveWithdrawal = asyncHandler(async (req, res) => {
  const record = await service.approveResignationWithdrawal(
    req.tenant, req.params.id, req.user?.id
  );
  return ApiResponse.ok(res, record, 'Resignation withdrawal approved successfully');
});

const rejectWithdrawal = asyncHandler(async (req, res) => {
  const record = await service.rejectResignationWithdrawal(
    req.tenant, req.params.id, req.body.rejection_reason, req.user?.id
  );
  return ApiResponse.ok(res, record, 'Resignation withdrawal rejected successfully');
});

const uploadClearanceProof = asyncHandler(async (req, res) => {
  const ApiError = require('../../utils/ApiError');
  if (!req.file) throw ApiError.badRequest('No document file uploaded');
  
  const tenantDb = req.tenant?.dbName || 'default';
  const fileUrl = `/uploads/clearance-documents/${tenantDb}/${req.file.filename}`;
  
  const task = await service.updateClearanceTask(
    req.tenant,
    req.params.id,
    req.params.taskId,
    {
      document_url: fileUrl,
      document_name: req.file.originalname,
      uploaded_at: new Date()
    },
    req.user?.id
  );
  
  return ApiResponse.ok(res, task, 'Clearance proof document uploaded successfully');
});

const getPipelineStages = asyncHandler(async (req, res) => {
  const data = await exitSettingsService.getExitPipelineStages(req.tenant);
  return ApiResponse.ok(res, data, 'Pipeline stages retrieved');
});

module.exports = {
  list,
  stats,
  getOne,
  createResignation,
  createTermination,
  update,
  approve,
  reject,
  updateStatus,
  listClearance,
  addClearance,
  updateClearance,
  listAssets,
  addAsset,
  updateAsset,
  listDocuments,
  generateDocument,
  terminationTypesDropdown,
  submitInterview,
  getInterview,
  submitSettlement,
  getSettlement,
  getAuditLog,
  withdrawResignation,
  approveWithdrawal,
  rejectWithdrawal,
  uploadClearanceProof,
  getPipelineStages,
};
