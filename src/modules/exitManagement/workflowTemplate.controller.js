'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./workflowTemplate.service');

const createWorkflow = asyncHandler(async (req, res) => {
  const workflow = await service.createWorkflow(req.tenant, req.body);
  return ApiResponse.created(res, workflow, 'Workflow template created successfully');
});

const listWorkflows = asyncHandler(async (req, res) => {
  const workflows = await service.listWorkflows(req.tenant, req.query);
  return ApiResponse.ok(res, workflows, 'Workflows retrieved successfully');
});

const getWorkflow = asyncHandler(async (req, res) => {
  const workflow = await service.getWorkflowById(req.tenant, req.params.id);
  return ApiResponse.ok(res, workflow, 'Workflow retrieved successfully');
});

const updateWorkflow = asyncHandler(async (req, res) => {
  const workflow = await service.updateWorkflow(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, workflow, 'Workflow updated successfully');
});

const publishWorkflow = asyncHandler(async (req, res) => {
  const workflow = await service.publishWorkflow(req.tenant, req.params.id);
  return ApiResponse.ok(res, workflow, 'Workflow published successfully');
});

const deleteWorkflow = asyncHandler(async (req, res) => {
  await service.deleteWorkflow(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Workflow deleted successfully');
});

const cloneWorkflow = asyncHandler(async (req, res) => {
  const workflow = await service.cloneWorkflow(req.tenant, req.params.id);
  return ApiResponse.created(res, workflow, 'Workflow duplicated as a new draft');
});

module.exports = {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
  publishWorkflow,
  cloneWorkflow,
  deleteWorkflow,
};
