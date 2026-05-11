'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('./departments.service');

const list = asyncHandler(async (req, res) => {
  const departments = await service.listDepartments(req.tenant);
  return ApiResponse.ok(res, departments, 'Departments retrieved successfully');
});

const listManagers = asyncHandler(async (req, res) => {
  const managers = await service.listDepartmentManagers(req.tenant);
  return ApiResponse.ok(res, managers, 'Department managers retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const department = await service.getDepartment(req.tenant, req.params.id);
  return ApiResponse.ok(res, department, 'Department retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { head, manager_id, is_active, ...rest } = req.body;
  const department = await service.createDepartment(req.tenant, {
    ...rest,
    headName: head,
    managerId: rest.managerId ?? manager_id,
    isActive: rest.isActive ?? is_active
  });
  return ApiResponse.created(res, department, 'Department created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { head, manager_id, is_active, ...rest } = req.body;
  const department = await service.updateDepartment(req.tenant, req.params.id, {
    ...rest,
    headName: head,
    managerId: rest.managerId ?? manager_id,
    isActive: rest.isActive ?? is_active
  });
  return ApiResponse.ok(res, department, 'Department updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteDepartment(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Department deleted successfully');
});

module.exports = {
  list,
  listManagers,
  getOne,
  create,
  update,
  remove
};
