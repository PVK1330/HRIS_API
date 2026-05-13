'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./visa-records.service');
const exportLib = require('./visa-records.export');

function exportFilename(ext) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `visa_records_export_${y}-${m}-${day}.${ext}`;
}

const list = asyncHandler(async (req, res) => {
  const data = await service.listVisaRecords(req.tenant, req.query);
  return ApiResponse.ok(res, data, 'Visa records retrieved successfully');
});

const stats = asyncHandler(async (req, res) => {
  const data = await service.getStats(req.tenant);
  return ApiResponse.ok(res, data, 'Stats retrieved successfully');
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
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename('xlsx')}"`);
    await exportLib.buildExcel(res, rows, applied);
    return undefined;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename('pdf')}"`);
  exportLib.buildPDF(res, rows, applied);
  return undefined;
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getVisaRecord(req.tenant, req.params.id);
  return ApiResponse.ok(res, row, 'Visa record retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const row = await service.createVisaRecord(req.tenant, req.body, req.files, req.user?.id);
  return ApiResponse.created(res, row, 'Visa record created successfully');
});

const update = asyncHandler(async (req, res) => {
  const row = await service.updateVisaRecord(req.tenant, req.params.id, req.body, req.files, req.user?.id);
  return ApiResponse.ok(res, row, 'Visa record updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteVisaRecord(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Visa record archived successfully');
});

module.exports = {
  list,
  stats,
  filterOptions,
  exportList,
  getOne,
  create,
  update,
  remove,
};
