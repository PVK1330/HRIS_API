"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const service = require("./employees.service");

// GET /api/v1/employees?page=1&limit=20&search=&department=&status=&workMode=&jobTitle=&workLocation=
const list = asyncHandler(async (req, res) => {
  const result = await service.listEmployees(req.user, req.query);
  return ApiResponse.ok(res, result, "Employees retrieved successfully");
});

const stats = asyncHandler(async (req, res) => {
  const data = await service.getStats(req.user);
  return ApiResponse.ok(res, data, "Stats retrieved successfully");
});

const filterOptions = asyncHandler(async (req, res) => {
  const data = await service.getFilterOptions(req.user);
  return ApiResponse.ok(res, data, "Filter options retrieved successfully");
});

const getOne = asyncHandler(async (req, res) => {
  const emp = await service.getEmployee(req.user, req.params.id);
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
  const emp = await service.updateEmployee(req.user, req.params.id, req.body);
  return ApiResponse.ok(
    res,
    { employee: emp },
    "Employee updated successfully",
  );
});

// DELETE /api/v1/employees/:id
const remove = asyncHandler(async (req, res) => {
  await service.deleteEmployee(req.user, req.params.id);
  return ApiResponse.ok(res, null, "Employee deleted successfully");
});

module.exports = { list, stats, filterOptions, getOne, create, update, remove };
