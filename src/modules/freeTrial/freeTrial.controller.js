'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./freeTrial.service');

const get = asyncHandler(async (_req, res) => {
  const data = await service.getFreeTrial();
  return ApiResponse.ok(res, data, 'Free trial settings retrieved');
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateFreeTrial(req.body || {});
  return ApiResponse.ok(res, data, 'Free trial settings updated');
});

module.exports = { get, update };
