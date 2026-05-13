'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./visa-types.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.listVisaTypes(req.tenant, req.query);
  return ApiResponse.ok(res, data, 'Visa types retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getVisaType(req.tenant, req.params.id);
  return ApiResponse.ok(res, row, 'Visa type retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const row = await service.createVisaType(req.tenant, req.body, req.user?.id);
  return ApiResponse.created(res, row, 'Visa type created successfully');
});

const update = asyncHandler(async (req, res) => {
  const row = await service.updateVisaType(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, row, 'Visa type updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteVisaType(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Visa type archived successfully');
});

module.exports = { list, getOne, create, update, remove };
