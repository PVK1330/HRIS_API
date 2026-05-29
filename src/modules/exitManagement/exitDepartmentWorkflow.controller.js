'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./exitDepartmentWorkflow.service');

const listDepartments = asyncHandler(async (req, res) => {
  const rows = await service.listDepartmentsWithHeads(req.tenant);
  return ApiResponse.ok(res, rows, 'Departments retrieved');
});

const getWorkflow = asyncHandler(async (req, res) => {
  const data = await service.getWorkflowForExit(req.tenant, req.params.id);
  return ApiResponse.ok(res, data, 'Exit workflow retrieved');
});

const assignWorkflow = asyncHandler(async (req, res) => {
  const data = await service.assignDepartments(
    req.tenant,
    req.params.id,
    req.body.steps,
    req.user?.id,
    req.user?.name,
  );
  return ApiResponse.ok(res, data, 'Department workflow assigned');
});

const reorderWorkflow = asyncHandler(async (req, res) => {
  const data = await service.reorderWorkflow(
    req.tenant,
    req.params.id,
    req.body.ordered_step_ids,
    req.user?.id,
  );
  return ApiResponse.ok(res, data, 'Workflow sequence updated');
});

const approveStep = asyncHandler(async (req, res) => {
  const data = await service.approveStep(
    req.tenant,
    req.params.id,
    req.params.stepId,
    req.user?.id,
    req.user,
    req.body.comments,
  );
  return ApiResponse.ok(res, data, 'Step approved');
});

const rejectStep = asyncHandler(async (req, res) => {
  const data = await service.rejectStep(
    req.tenant,
    req.params.id,
    req.params.stepId,
    req.user?.id,
    req.user,
    req.body.rejection_reason,
  );
  return ApiResponse.ok(res, data, 'Step rejected');
});

const skipStep = asyncHandler(async (req, res) => {
  const data = await service.skipStep(
    req.tenant,
    req.params.id,
    req.params.stepId,
    req.user?.id,
    req.user,
  );
  return ApiResponse.ok(res, data, 'Step skipped');
});

const reassignHead = asyncHandler(async (req, res) => {
  const data = await service.reassignHead(
    req.tenant,
    req.params.id,
    req.params.stepId,
    req.body.department_head_id,
    req.user?.id,
    req.user?.name,
  );
  return ApiResponse.ok(res, data, 'Department head reassigned');
});

const restartWorkflow = asyncHandler(async (req, res) => {
  const data = await service.restartWorkflow(
    req.tenant,
    req.params.id,
    req.user?.id,
    req.user?.name,
  );
  return ApiResponse.ok(res, data, 'Workflow restarted');
});

module.exports = {
  listDepartments,
  getWorkflow,
  assignWorkflow,
  reorderWorkflow,
  approveStep,
  rejectStep,
  skipStep,
  reassignHead,
  restartWorkflow,
};
