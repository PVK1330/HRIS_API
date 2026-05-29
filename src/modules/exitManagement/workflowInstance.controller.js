'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./workflowExecution.service');

const startWorkflow = asyncHandler(async (req, res) => {
  const result = await service.startWorkflow(
    req.tenant,
    req.body.employee_id,
    req.params.workflowId,
    req.user?.id
  );
  return ApiResponse.created(res, result, 'Workflow instance started successfully');
});

const approveStep = asyncHandler(async (req, res) => {
  const result = await service.approveStep(
    req.tenant,
    req.params.instanceId,
    req.params.stepId,
    req.user?.id,
    req.body.comments
  );
  return ApiResponse.ok(res, result, 'Step approved successfully');
});

const rejectStep = asyncHandler(async (req, res) => {
  const result = await service.rejectStep(
    req.tenant,
    req.params.instanceId,
    req.params.stepId,
    req.user?.id,
    req.body.comments
  );
  return ApiResponse.ok(res, result, 'Step rejected successfully');
});

module.exports = {
  startWorkflow,
  approveStep,
  rejectStep
};
