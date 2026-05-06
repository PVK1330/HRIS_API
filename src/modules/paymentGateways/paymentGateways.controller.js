'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./paymentGateways.service');

const list = asyncHandler(async (_req, res) => {
  const data = await service.getAllGateways();
  return ApiResponse.ok(res, data, 'Payment gateways retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const data = await service.getGatewayBySlug(req.params.slug);
  return ApiResponse.ok(res, data, 'Payment gateway retrieved');
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateGateway(req.params.slug, req.body || {});
  return ApiResponse.ok(res, data, 'Payment gateway updated');
});

const test = asyncHandler(async (req, res) => {
  const data = await service.testGateway(req.params.slug);
  return ApiResponse.ok(res, data, data.verified ? 'Gateway verified' : 'Gateway verification failed');
});

module.exports = {
  list,
  getOne,
  update,
  test,
};
