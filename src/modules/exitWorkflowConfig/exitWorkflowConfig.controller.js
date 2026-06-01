'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./exitWorkflowConfig.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.listWorkflows(req.tenant, { activeOnly: req.query.activeOnly === 'true' });
  return ApiResponse.ok(res, data, 'Workflows retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const data = await service.getWorkflow(req.tenant, req.params.workflowId);
  return ApiResponse.ok(res, data, 'Workflow retrieved');
});

const create = asyncHandler(async (req, res) => {
  const data = await service.createWorkflow(req.tenant, req.body, req.exitUser);
  return ApiResponse.created(res, data, 'Workflow created');
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateWorkflow(req.tenant, req.params.workflowId, req.body);
  return ApiResponse.ok(res, data, 'Workflow updated');
});

const setDefault = asyncHandler(async (req, res) => {
  const data = await service.setDefaultWorkflow(req.tenant, req.params.workflowId);
  return ApiResponse.ok(res, data, 'Workflow set as default');
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.deleteWorkflow(req.tenant, req.params.workflowId);
  return ApiResponse.ok(res, data, 'Workflow deactivated');
});

const options = asyncHandler(async (req, res) => {
  const data = await service.getBuilderOptions(req.tenant);
  return ApiResponse.ok(res, data, 'Builder options retrieved');
});

module.exports = { list, getOne, create, update, setDefault, remove, options };
