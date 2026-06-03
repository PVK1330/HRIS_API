'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./onboardingHandover.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.listRules(req.tenant);
  return ApiResponse.ok(res, data, 'Handover rules retrieved');
});

const create = asyncHandler(async (req, res) => {
  const data = await service.createRule(req.tenant, req.body);
  return ApiResponse.ok(res, data, 'Handover rule created', 201);
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateRule(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, data, 'Handover rule updated');
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.deleteRule(req.tenant, req.params.id);
  return ApiResponse.ok(res, data, 'Handover rule deleted');
});

module.exports = { list, create, update, remove };
