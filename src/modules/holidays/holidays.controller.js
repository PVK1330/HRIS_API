'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./holidays.service');

const list = asyncHandler(async (req, res) => {
  const data = await service.listCalendars(req.user.db_name, req.query);
  return ApiResponse.ok(res, data);
});

const detail = asyncHandler(async (req, res) => {
  const data = await service.getCalendarDetail(req.user.db_name, req.params.calendarId);
  return ApiResponse.ok(res, data);
});

const seed = asyncHandler(async (req, res) => {
  const pool = require('../../config/db').getTenantPool(req.user.db_name);
  const regions = req.body.regions || req.query.regions?.split(',');
  const data = await service.seedFromConfig(pool, {
    year: parseInt(req.body.year || req.query.year, 10) || undefined,
    regions: Array.isArray(regions) ? regions : regions ? [regions] : undefined,
  });
  return ApiResponse.ok(res, data, 'UK holidays seeded from configuration');
});

const createDate = asyncHandler(async (req, res) => {
  const data = await service.createHolidayDate(
    req.user.db_name,
    req.user.db_name,
    { calendarId: req.params.calendarId, ...req.body },
    req,
  );
  return ApiResponse.created(res, data);
});

const updateDate = asyncHandler(async (req, res) => {
  const data = await service.updateHolidayDate(
    req.user.db_name,
    req.user.db_name,
    req.params.id,
    req.body,
    req,
  );
  return ApiResponse.ok(res, data);
});

const removeDate = asyncHandler(async (req, res) => {
  const data = await service.deleteHolidayDate(req.user.db_name, req.user.db_name, req.params.id, req);
  return ApiResponse.ok(res, data);
});

module.exports = { list, detail, seed, createDate, updateDate, removeDate };
