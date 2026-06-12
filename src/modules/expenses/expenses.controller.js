"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const service = require("./expenses.service");
const ApiError = require("../../utils/ApiError");

function scopedQuery(req) {
  const query = { ...req.query };
  if (req.user?.role === "employee" && req.user?.employeeId) {
    query.employeeId = String(req.user.employeeId);
  }
  return query;
}

function assertCanViewExpense(req, row) {
  if (req.user?.role === "employee" && req.user?.employeeId) {
    if (
      parseInt(String(row.employee_id), 10) !==
      parseInt(String(req.user.employeeId), 10)
    ) {
      throw ApiError.forbidden("You cannot access this expense claim");
    }
  }
}

const list = asyncHandler(async (req, res) => {
  const result = await service.listExpenses(req.tenant, scopedQuery(req));
  return ApiResponse.ok(res, result.data, "Expenses retrieved successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await service.getExpense(req.tenant, req.params.id);
  assertCanViewExpense(req, row);
  return ApiResponse.ok(res, row, "Expense claim retrieved successfully");
});

const create = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (req.user?.role === "employee" && req.user?.employeeId) {
    body.employeeId = String(req.user.employeeId);
  }
  if (!body.employeeId) {
    throw ApiError.badRequest("employeeId is required");
  }
  const row = await service.createExpense(req.tenant, body, req.file);
  return ApiResponse.created(res, row, "Expense claim created successfully");
});

const update = asyncHandler(async (req, res) => {
  const row = await service.updateExpenseClaim(
    req.tenant,
    req.params.id,
    req.body,
    req.user,
    req.file,
  );
  assertCanViewExpense(req, row);
  return ApiResponse.ok(res, row, "Expense claim updated successfully");
});

const updateStatus = asyncHandler(async (req, res) => {
  if (req.user?.role === "employee") {
    throw ApiError.forbidden("Not allowed to change approval status");
  }
  const {
    status,
    rejectionReason,
    rejection_reason,
    comments,
    paymentReference,
    payment_reference,
    paymentDate,
    payment_date,
  } = req.body;
  const row = await service.updateExpenseStatus(
    req.tenant,
    req.params.id,
    {
      status,
      rejectionReason: rejectionReason ?? rejection_reason,
      comments,
      paymentReference: paymentReference ?? payment_reference,
      paymentDate: paymentDate ?? payment_date,
    },
    req.user?.id,
  );
  return ApiResponse.ok(res, row, "Expense claim status updated successfully");
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await service.getExpensesStats(req.tenant, scopedQuery(req));
  return ApiResponse.ok(
    res,
    stats,
    "Expense statistics retrieved successfully",
  );
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteExpense(req.tenant, req.params.id, req.user);
  return ApiResponse.ok(res, null, "Expense claim deleted successfully");
});

// Approval-level config (EXP-02)
const getApprovalLevels = asyncHandler(async (req, res) => {
  const levels = await service.listApprovalLevels(req.tenant);
  return ApiResponse.ok(res, levels, "Approval levels retrieved successfully");
});

const setApprovalLevels = asyncHandler(async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : req.body?.levels;
  const levels = await service.replaceApprovalLevels(req.tenant, payload);
  return ApiResponse.ok(res, levels, "Approval levels updated successfully");
});

// Excel export (EXP-10)
const exportExpenses = asyncHandler(async (req, res) => {
  const workbook = await service.exportExpenses(req.tenant, scopedQuery(req));
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="expenses_export.xlsx"',
  );
  await workbook.xlsx.write(res);
  res.end();
});

// Excel bulk import (EXP-30)
const importExpenses = asyncHandler(async (req, res) => {
  if (!req.file?.buffer)
    throw ApiError.badRequest("Please upload an Excel file (.xlsx or .xls)");
  const result = await service.importExpenses(
    req.tenant,
    req.file.buffer,
    req.user?.id,
  );
  return ApiResponse.ok(
    res,
    result,
    `Import complete: ${result.imported} added, ${result.skipped} skipped`,
  );
});

// Download blank import template (EXP-30)
const downloadImportTemplate = asyncHandler(async (req, res) => {
  const workbook = await service.generateImportTemplate();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="expense_import_template.xlsx"',
  );
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = {
  list,
  getOne,
  create,
  update,
  updateStatus,
  getStats,
  remove,
  getApprovalLevels,
  setApprovalLevels,
  exportExpenses,
  importExpenses,
  downloadImportTemplate,
};
