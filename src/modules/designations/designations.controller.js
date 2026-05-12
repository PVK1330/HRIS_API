'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./designations.service');

const list = asyncHandler(async (req, res) => {
  const result = await service.listDesignations(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Designations retrieved successfully');
});

const listByDepartment = asyncHandler(async (req, res) => {
  const raw = req.params.deptName;
  const deptName = raw ? decodeURIComponent(String(raw)) : '';
  const rows = await service.listDesignationsByDepartmentName(req.tenant, deptName);
  return ApiResponse.ok(res, rows, 'Designations retrieved successfully');
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
  return ApiResponse.ok(res, null, 'Designation archived successfully');
});

module.exports = {
  list,
  listByDepartment,
  getOne,
  create,
  update,
  remove,
};
