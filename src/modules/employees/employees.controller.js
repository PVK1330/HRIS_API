"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const service = require("./employees.service");
const exportLib = require("./employees.export");

function exportFilename(entity, ext) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${entity}_export_${y}-${m}-${day}.${ext}`;
}

// GET /api/v1/employees?page=1&limit=20&search=&department=&status=&workMode=&jobTitle=&workLocation=
const list = asyncHandler(async (req, res) => {
  const result = await service.listEmployees(req.user, req.query, req.auth);
  return ApiResponse.ok(res, result, "Employees retrieved successfully");
});

/** GET /employees/dropdown — full id/name list for selects (no pagination). */
const dropdownList = asyncHandler(async (req, res) => {
  const result = await service.listEmployeesDropdown(req.user, req.query, req.auth);
  return ApiResponse.ok(res, result, "Employees retrieved successfully");
});

const exportList = asyncHandler(async (req, res) => {
  const type = String(req.query.type || "").toLowerCase();
  if (!["pdf", "excel"].includes(type)) {
    throw new ApiError(400, "Query param type must be pdf or excel");
  }
  const { type: _t, ...rest } = req.query;
  const rows = await service.listEmployeesForExport(req.user, rest, req.auth);
  const applied = { ...rest, type };
  if (type === "excel") {
    const name = exportFilename("employees", "xlsx");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    await exportLib.buildExcel(res, rows);
    return undefined;
  }
  const name = exportFilename("employees", "pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  exportLib.buildPDF(res, rows, applied);
  return undefined;
});

const stats = asyncHandler(async (req, res) => {
  const data = await service.getStats(req.user);
  return ApiResponse.ok(res, data, "Stats retrieved successfully");
});

const filterOptions = asyncHandler(async (req, res) => {
  const data = await service.getFilterOptions(req.user);
  return ApiResponse.ok(res, data, "Filter options retrieved successfully");
});

const nextEmpId = asyncHandler(async (req, res) => {
  const nextId = await service.getNextEmployeeId(req.user);
  return ApiResponse.ok(res, { nextEmpId: nextId }, "Next employee ID");
});

const getOne = asyncHandler(async (req, res) => {
  const emp = await service.getEmployee(req.user, req.params.id, req.auth);
  return ApiResponse.ok(
    res,
    { employee: emp },
    "Employee retrieved successfully",
  );
});

const create = asyncHandler(async (req, res) => {
  const emp = await service.createEmployee(req.user, req.body);
  return ApiResponse.created(
    res,
    { employee: emp },
    "Employee created successfully",
  );
});

const update = asyncHandler(async (req, res) => {
  const emp = await service.updateEmployee(req.user, req.params.id, req.body, req.auth);
  return ApiResponse.ok(
    res,
    { employee: emp },
    "Employee updated successfully",
  );
});

// DELETE /api/v1/employees/:id
const remove = asyncHandler(async (req, res) => {
  await service.deleteEmployee(req.user, req.params.id, req.auth);
  return ApiResponse.ok(res, null, "Employee deleted successfully");
});

module.exports = {
  list,
  dropdownList,
  exportList,
  stats,
  filterOptions,
  nextEmpId,
  getOne,
  create,
  update,
  remove,
};
