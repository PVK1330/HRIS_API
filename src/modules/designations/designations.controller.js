'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./designations.service');

const list = asyncHandler(async (req, res) => {
  const designations = await service.listDesignations(req.tenant);
  return ApiResponse.ok(res, designations, 'Designations retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const designation = await service.getDesignation(req.tenant, req.params.id);
  return ApiResponse.ok(res, designation, 'Designation retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const designation = await service.createDesignation(req.tenant, req.body);
  return ApiResponse.created(res, designation, 'Designation created successfully');
});

const update = asyncHandler(async (req, res) => {
  const designation = await service.updateDesignation(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, designation, 'Designation updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteDesignation(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Designation deleted successfully');
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
};
