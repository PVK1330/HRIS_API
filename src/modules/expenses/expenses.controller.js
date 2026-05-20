'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./expenses.service');
const ApiError = require('../../utils/ApiError');

function scopedQuery(req) {
  const query = { ...req.query };
  if (req.user?.role === 'employee' && req.user?.employeeId) {
    query.employeeId = String(req.user.employeeId);
  }
  return query;
}

function assertCanViewExpense(req, row) {
  if (req.user?.role === 'employee' && req.user?.employeeId) {
    if (parseInt(String(row.employee_id), 10) !== parseInt(String(req.user.employeeId), 10)) {
      throw ApiError.forbidden('You cannot access this expense claim');
    }
  }
}

const list = asyncHandler(async (req, res) => {
  const result = await service.listExpenses(req.tenant, scopedQuery(req));
  return ApiResponse.ok(res, result.data, 'Expenses retrieved successfully', {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getExpense(req.tenant, req.params.id);
  assertCanViewExpense(req, row);
  return ApiResponse.ok(res, row, 'Expense claim retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (req.user?.role === 'employee' && req.user?.employeeId) {
    body.employeeId = String(req.user.employeeId);
  }
  if (!body.employeeId) {
    throw ApiError.badRequest('employeeId is required');
  }
  const row = await service.createExpense(req.tenant, body, req.file);
  return ApiResponse.created(res, row, 'Expense claim created successfully');
});

const update = asyncHandler(async (req, res) => {
  const row = await service.updateExpenseClaim(req.tenant, req.params.id, req.body, req.user);
  assertCanViewExpense(req, row);
  return ApiResponse.ok(res, row, 'Expense claim updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
  if (req.user?.role === 'employee') {
    throw ApiError.forbidden('Not allowed to change approval status');
  }
  const { status, rejectionReason, rejection_reason: rejection_reason_snake } = req.body;
  const row = await service.updateExpenseStatus(
    req.tenant,
    req.params.id,
    { status, rejectionReason: rejectionReason ?? rejection_reason_snake },
    req.user?.id,
  );
  return ApiResponse.ok(res, row, 'Expense claim status updated successfully');
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await service.getExpensesStats(req.tenant, scopedQuery(req));
  return ApiResponse.ok(res, stats, 'Expense statistics retrieved successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteExpense(req.tenant, req.params.id, req.user);
  return ApiResponse.ok(res, null, 'Expense claim deleted successfully');
});

module.exports = {
  list,
  getOne,
  create,
  update,
  updateStatus,
  getStats,
  remove,
};
