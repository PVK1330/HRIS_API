'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./recaptcha.service');

const get = asyncHandler(async (_req, res) => {
  const data = await service.getRecaptcha();
  return ApiResponse.ok(res, data, 'reCAPTCHA settings retrieved');
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateRecaptcha(req.body || {});
  return ApiResponse.ok(res, data, 'reCAPTCHA settings updated');
});

const test = asyncHandler(async (_req, res) => {
  const data = await service.testRecaptcha();
  return ApiResponse.ok(
    res,
    data,
    data.verified ? 'reCAPTCHA verified' : 'reCAPTCHA verification failed'
  );
});

module.exports = { get, update, test };
