'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./expenses.service');

const list = asyncHandler(async (req, res) => {
  const result = await service.listExpenses(req.tenant, req.query);
  return ApiResponse.ok(res, result.data, 'Expenses retrieved successfully', {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getExpense(req.tenant, req.params.id);
  return ApiResponse.ok(res, row, 'Expense claim retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const row = await service.createExpense(req.tenant, req.body, req.file);
  return ApiResponse.created(res, row, 'Expense claim created successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const row = await service.updateExpenseStatus(req.tenant, req.params.id, status, req.user?.id);
  return ApiResponse.ok(res, row, 'Expense claim status updated successfully');
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await service.getExpensesStats(req.tenant, req.query);
  return ApiResponse.ok(res, stats, 'Expense statistics retrieved successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteExpense(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Expense claim deleted successfully');
});

module.exports = {
  list,
  getOne,
  create,
  updateStatus,
  getStats,
  remove
};
