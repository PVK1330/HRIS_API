'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./locations.service');
const ApiResponse = require('../../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const result = await service.listLocations(req.tenant, req.query);
  return ApiResponse.ok(res, result, 'Locations retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const loc = await service.getLocation(req.tenant, Number(req.params.id));
  if (!loc) return res.status(404).json({ status: 'error', message: 'Location not found' });
  return ApiResponse.ok(res, loc, 'Location retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const loc = await service.createLocation(req.tenant, { ...req.body, createdBy: req.user?.id });
  return ApiResponse.created(res, loc, 'Location created successfully');
});

const update = asyncHandler(async (req, res) => {
  const loc = await service.updateLocation(req.tenant, Number(req.params.id), req.body);
  if (!loc) return res.status(404).json({ status: 'error', message: 'Location not found' });
  return ApiResponse.ok(res, loc, 'Location updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  const deleted = await service.deleteLocation(req.tenant, Number(req.params.id));
  if (!deleted) return res.status(404).json({ status: 'error', message: 'Location not found' });
  return ApiResponse.ok(res, null, 'Location deleted successfully');
});

module.exports = { list, getOne, create, update, remove };
