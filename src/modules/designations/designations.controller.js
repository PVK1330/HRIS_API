'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./designations.service');
const exportLib = require('./designations.export');

function exportFilename(entity, ext) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${entity}_export_${y}-${m}-${day}.${ext}`;
}

const list = asyncHandler(async (req, res) => {
  const result = await service.listDesignations(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Designations retrieved successfully');
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
    const name = exportFilename('designations', 'xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await exportLib.buildExcel(res, rows, applied);
    return undefined;
  }
  const name = exportFilename('designations', 'pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  exportLib.buildPDF(res, rows, applied);
  return undefined;
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
  const designation = await service.createDesignation(req.tenant, {
    ...req.body,
    createdBy: req.user?.id,
  });
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
  filterOptions,
  exportList,
  listByDepartment,
  getOne,
  create,
  update,
  remove,
};
