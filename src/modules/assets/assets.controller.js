'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./assets.service');

const list = asyncHandler(async (req, res) => {
  const assets = await service.listAssets(req.tenant);
  return ApiResponse.ok(res, assets, 'Assets retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const asset = await service.getAsset(req.tenant, req.params.id);
  return ApiResponse.ok(res, asset, 'Asset retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const asset = await service.createAsset(req.tenant, req.body);
  return ApiResponse.created(res, asset, 'Asset created successfully');
});

const update = asyncHandler(async (req, res) => {
  const asset = await service.updateAsset(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, asset, 'Asset updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteAsset(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Asset deleted successfully');
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove
};
