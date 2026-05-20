'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./expenseCategories.service');

function requireTenantAdmin(req, _res, next) {
  if (req.user?.role === 'admin') return next();
  return next(ApiError.forbidden('Only organization administrators can manage expense categories'));
}

const list = asyncHandler(async (req, res) => {
  const rows = await service.listExpenseCategories(req.tenant, req.query);
  return ApiResponse.ok(res, rows, 'Expense categories retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getExpenseCategory(req.tenant, req.params.id);
  return ApiResponse.ok(res, row, 'Expense category retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const row = await service.createExpenseCategory(req.tenant, req.body);
  return ApiResponse.created(res, row, 'Expense category created successfully');
});

const update = asyncHandler(async (req, res) => {
  const row = await service.updateExpenseCategory(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, row, 'Expense category updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteExpenseCategory(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Expense category deactivated successfully');
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  requireTenantAdmin,
};
