'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./exitSettings.service');

const list = asyncHandler(async (req, res) => {
  const result = await service.listTerminationTypes(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Termination types retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const record = await service.getTerminationType(req.tenant, req.params.id);
  return ApiResponse.ok(res, record, 'Termination type retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const record = await service.createTerminationType(req.tenant, req.body);
  return ApiResponse.created(res, record, 'Termination type created successfully');
});

const update = asyncHandler(async (req, res) => {
  const record = await service.updateTerminationType(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, record, 'Termination type updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteTerminationType(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Termination type archived successfully');
});

const listClearance = asyncHandler(async (req, res) => {
  const result = await service.listClearanceTemplates(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Clearance templates retrieved successfully');
});

const getClearance = asyncHandler(async (req, res) => {
  const record = await service.getClearanceTemplate(req.tenant, req.params.id);
  return ApiResponse.ok(res, record, 'Clearance template retrieved successfully');
});

const createClearance = asyncHandler(async (req, res) => {
  const record = await service.createClearanceTemplate(req.tenant, req.body);
  return ApiResponse.created(res, record, 'Clearance template created successfully');
});

const updateClearance = asyncHandler(async (req, res) => {
  const record = await service.updateClearanceTemplate(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, record, 'Clearance template updated successfully');
});

const removeClearance = asyncHandler(async (req, res) => {
  await service.deleteClearanceTemplate(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Clearance template deleted successfully');
});

const getOrgWorkflow = asyncHandler(async (req, res) => {
  const data = await service.getOrgDepartmentWorkflowTemplate(req.tenant);
  return ApiResponse.ok(res, data, 'Default department workflow retrieved');
});

const saveOrgWorkflow = asyncHandler(async (req, res) => {
  const data = await service.saveOrgDepartmentWorkflowTemplate(req.tenant, req.body.steps);
  return ApiResponse.ok(res, data, 'Default department workflow saved');
});

const getPipelineStages = asyncHandler(async (req, res) => {
  const data = await service.getExitPipelineStages(req.tenant);
  return ApiResponse.ok(res, data, 'Pipeline stages retrieved');
});

const savePipelineStages = asyncHandler(async (req, res) => {
  const data = await service.saveExitPipelineStages(req.tenant, req.body.stages);
  return ApiResponse.ok(res, data, 'Pipeline stages saved');
});

const getWorkflowConfig = asyncHandler(async (req, res) => {
  const data = await service.getExitWorkflowConfig(req.tenant);
  return ApiResponse.ok(res, data, 'Exit workflow configuration retrieved');
});

const saveWorkflowConfig = asyncHandler(async (req, res) => {
  const data = await service.saveExitWorkflowConfig(req.tenant, req.body);
  return ApiResponse.ok(res, data, 'Exit workflow configuration saved');
});

module.exports = {
  list, getOne, create, update, remove,
  listClearance, getClearance, createClearance, updateClearance, removeClearance,
  getOrgWorkflow, saveOrgWorkflow,
  getPipelineStages, savePipelineStages,
  getWorkflowConfig, saveWorkflowConfig,
};
