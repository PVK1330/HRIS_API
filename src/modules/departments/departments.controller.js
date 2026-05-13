'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./departments.service');
const exportLib = require('./departments.export');

function exportFilename(entity, ext) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${entity}_export_${y}-${m}-${day}.${ext}`;
}

const list = asyncHandler(async (req, res) => {
  const result = await service.listDepartments(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Departments retrieved successfully');
});

const filterOptions = asyncHandler(async (req, res) => {
  const data = await service.getFilterOptions(req.tenant);
  return ApiResponse.ok(res, data, 'Filter options retrieved successfully');
});

const exportList = asyncHandler(async (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  if (!['pdf', 'excel'].includes(type)) {
    throw new ApiError(400, 'Query param type must be pdf or excel');
  }
  const { type: _t, ...rest } = req.query;
  const rows = await service.listAllForExport(req.tenant, rest);
  const applied = { ...rest, type };
  if (type === 'excel') {
    const name = exportFilename('departments', 'xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await exportLib.buildExcel(res, rows, applied);
    return undefined;
  }
  const name = exportFilename('departments', 'pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  exportLib.buildPDF(res, rows, applied);
  return undefined;
});

const listManagers = asyncHandler(async (req, res) => {
  const managers = await service.listDepartmentManagers(req.tenant);
  return ApiResponse.ok(res, managers, 'Managers retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const department = await service.getDepartment(req.tenant, req.params.id);
  return ApiResponse.ok(res, department, 'Department retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const department = await service.createDepartment(req.tenant, {
    ...req.body,
    createdBy: req.user?.id,
  });
  return ApiResponse.created(res, department, 'Department created successfully');
});

const update = asyncHandler(async (req, res) => {
  const department = await service.updateDepartment(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, department, 'Department updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteDepartment(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Department archived successfully');
});

module.exports = {
  list,
  filterOptions,
  exportList,
  listManagers,
  getOne,
  create,
  update,
  remove,
};
