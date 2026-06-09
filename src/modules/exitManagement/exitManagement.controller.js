  'use strict';

  const asyncHandler = require('../../utils/asyncHandler');
  const ApiResponse = require('../../utils/ApiResponse');
  const ApiError = require('../../utils/ApiError');
  const service = require('./exitManagement.service');
  const dashboard = require('./exitDashboard.service');
  const stageActions = require('./exitStageActions.service');
  const exitDocuments = require('./exitDocuments.service');
  const exitEvents = require('./exitEvents.service');

  /** Build the actor context the service expects (employeeId + display name). */
  function actor(req) {
    return { ...req.exitUser, actorName: req.user?.name || null };
  }

  const list = asyncHandler(async (req, res) => {
    const result = await service.listExitRequests(req.tenant, req.query, req.exitUser);
    return ApiResponse.ok(res, result, 'Exit requests retrieved successfully');
  });

  const stats = asyncHandler(async (req, res) => {
    const result = await dashboard.getDashboardWidgets(req.tenant, req.exitUser);
    return ApiResponse.ok(res, result, 'Stats retrieved successfully');
  });

  const getOne = asyncHandler(async (req, res) => {
    const record = await service.getExitRequest(req.tenant, req.params.id, req.exitUser);
    return ApiResponse.ok(res, record, 'Exit request retrieved successfully');
  });

  const create = asyncHandler(async (req, res) => {
    const record = await service.submitExitRequest(req.tenant, req.body, actor(req), req.file);
    return ApiResponse.created(res, record, 'Exit request submitted successfully');
  });

  const approve = asyncHandler(async (req, res) => {
    const record = await service.approveStage(req.tenant, req.params.id, actor(req), req.body.comments);
    return ApiResponse.ok(res, record, 'Stage approved successfully');
  });

  const reject = asyncHandler(async (req, res) => {
    const record = await service.rejectStage(req.tenant, req.params.id, actor(req), req.body.rejection_reason);
    return ApiResponse.ok(res, record, 'Exit request rejected');
  });

  const sendBack = asyncHandler(async (req, res) => {
    const record = await service.sendBackStage(req.tenant, req.params.id, actor(req), req.body);
    return ApiResponse.ok(res, record, 'Exit request sent back');
  });

  const escalate = asyncHandler(async (req, res) => {
    const record = await service.escalateStage(req.tenant, req.params.id, actor(req), req.body.comments);
    return ApiResponse.ok(res, record, 'Stage escalated');
  });

  const reassign = asyncHandler(async (req, res) => {
    const record = await service.reassignStage(req.tenant, req.params.id, actor(req), req.body);
    return ApiResponse.ok(res, record, 'Stage owner reassigned');
  });

  const comment = asyncHandler(async (req, res) => {
    const record = await service.addComment(req.tenant, req.params.id, actor(req), req.body.comments);
    return ApiResponse.ok(res, record, 'Comment added');
  });

  const withdraw = asyncHandler(async (req, res) => {
    const record = await service.withdrawExitRequest(req.tenant, req.params.id, actor(req), req.body.withdrawal_reason);
    return ApiResponse.ok(res, record, 'Exit request withdrawn');
  });

  const auditLog = asyncHandler(async (req, res) => {
    const logs = await service.getAuditLog(req.tenant, req.params.id);
    return ApiResponse.ok(res, logs, 'Audit log retrieved');
  });

  const terminationTypes = asyncHandler(async (req, res) => {
    const types = await service.getActiveTerminationTypes(req.tenant);
    return ApiResponse.ok(res, types, 'Termination types retrieved');
  });

  const widgets = asyncHandler(async (req, res) => {
    const data = await dashboard.getDashboardWidgets(req.tenant, req.exitUser);
    return ApiResponse.ok(res, data, 'Dashboard widgets retrieved');
  });

  /* ---- stage-attached actions ---- */

  const listChecklist = asyncHandler(async (req, res) => {
    const items = await stageActions.listChecklist(req.tenant, req.params.id, req.params.stageId);
    return ApiResponse.ok(res, items, 'Checklist retrieved');
  });

  const addChecklist = asyncHandler(async (req, res) => {
    const item = await stageActions.addChecklistItem(req.tenant, req.params.id, req.params.stageId, req.body);
    return ApiResponse.created(res, item, 'Checklist item added');
  });

  const updateChecklist = asyncHandler(async (req, res) => {
    const item = await stageActions.updateChecklistItem(
      req.tenant, req.params.id, req.params.stageId, req.params.itemId, req.body, actor(req),
    );
    return ApiResponse.ok(res, item, 'Checklist item updated');
  });

  const listAssets = asyncHandler(async (req, res) => {
    const data = await stageActions.listEmployeeAssets(req.tenant, req.params.id);
    return ApiResponse.ok(res, data, 'Employee assets retrieved');
  });

  const returnAsset = asyncHandler(async (req, res) => {
    const asset = await stageActions.markAssetReturned(
      req.tenant, req.params.id, req.params.assetId, req.body, actor(req),
    );
    return ApiResponse.ok(res, asset, 'Asset updated');
  });

  /* ---- Exit tasks ---- */

  const myTasks = asyncHandler(async (req, res) => {
    const data = await exitEvents.listMyTasks(req.tenant, req.exitUser.employeeId, { status: req.query.status });
    return ApiResponse.ok(res, data, 'My exit tasks retrieved');
  });

  const requestTasks = asyncHandler(async (req, res) => {
    const data = await exitEvents.listRequestTasks(req.tenant, req.params.id);
    return ApiResponse.ok(res, data, 'Exit request tasks retrieved');
  });

  const completeTask = asyncHandler(async (req, res) => {
    const data = await exitEvents.completeTask(req.tenant, req.params.taskId, req.exitUser);
    return ApiResponse.ok(res, data, 'Task completed');
  });

  const setTaskDelayReason = asyncHandler(async (req, res) => {
    const data = await exitEvents.setTaskDelayReason(
      req.tenant,
      req.params.taskId,
      req.exitUser,
      req.body.reason,
    );
    return ApiResponse.ok(res, data, 'Task delay reason saved');
  });

  /* ---- Exit documents (letters) ---- */

  const listDocumentTemplates = asyncHandler(async (req, res) => {
    const data = await exitDocuments.listTemplates(req.tenant);
    return ApiResponse.ok(res, data, 'Exit document templates retrieved');
  });

  const listExitDocuments = asyncHandler(async (req, res) => {
    const data = await exitDocuments.listGenerated(req.tenant, req.params.id);
    return ApiResponse.ok(res, data, 'Generated documents retrieved');
  });

  const generateDocuments = asyncHandler(async (req, res) => {
    const data = await exitDocuments.generate(req.tenant, req.params.id, req.body, actor(req));
    return ApiResponse.created(res, data, 'Exit documents generated');
  });

  const downloadDocument = asyncHandler(async (req, res) => {
    const { absPath, fileName } = await exitDocuments.getDownload(req.tenant, req.params.id, req.params.attachmentId);
    return res.download(absPath, fileName);
  });

  const listAttachments = asyncHandler(async (req, res) => {
    const items = await stageActions.listAttachments(req.tenant, req.params.id);
    return ApiResponse.ok(res, items, 'Attachments retrieved');
  });

  const uploadAttachment = asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded');
    const item = await stageActions.addAttachment(
      req.tenant, req.params.id, req.params.stageId, req.file, req.body, actor(req),
    );
    return ApiResponse.created(res, item, 'Attachment uploaded');
  });

  module.exports = {
    list, getOne, create, approve, reject, sendBack, escalate, reassign, comment, withdraw,
    auditLog, terminationTypes, widgets, stats,
    listChecklist, addChecklist, updateChecklist, listAssets, returnAsset, listAttachments, uploadAttachment,
    listDocumentTemplates, listExitDocuments, generateDocuments, downloadDocument,
    myTasks, requestTasks, completeTask, setTaskDelayReason,
  };
