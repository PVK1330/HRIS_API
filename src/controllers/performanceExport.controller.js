'use strict';

const { getTenantPool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const performanceExportService = require('../services/performanceExport.service');

const getPerformanceCycles = asyncHandler(async (req, res) => {
  const pool = getTenantPool(req.user.db_name);
  const cycles = await performanceExportService.fetchCycles(pool);
  return ApiResponse.ok(res, cycles, 'Performance cycles retrieved successfully');
});

const exportPerformanceData = asyncHandler(async (req, res) => {
  const pool = getTenantPool(req.user.db_name);
  const { cycleId, startDate, endDate, departmentId, employeeId, exportType } = req.body;

  const result = await performanceExportService.exportData(pool, {
    cycleId,
    startDate,
    endDate,
    departmentId,
    employeeId,
    exportType,
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', result.contentDisposition);
  res.send(result.data);
});

module.exports = {
  getPerformanceCycles,
  exportPerformanceData,
};
