'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./policies.service');

const list = asyncHandler(async (req, res) => {
  const policies = await service.listPolicies(req.tenant, req.query);
  return ApiResponse.ok(res, policies, 'Policies retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const policy = await service.getPolicy(req.tenant, req.params.id);
  return ApiResponse.ok(res, policy, 'Policy retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const policy = await service.createPolicy(req.tenant, req.user, req.body);
  return ApiResponse.created(res, policy, 'Policy created successfully');
});

const update = asyncHandler(async (req, res) => {
  const policy = await service.updatePolicy(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, policy, 'Policy updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deletePolicy(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Policy deleted successfully');
});

const getTracking = asyncHandler(async (req, res) => {
  const tracking = await service.getCompliance(req.tenant, req.params.id);
  return ApiResponse.ok(res, tracking, 'Compliance tracking retrieved successfully');
});

const listMine = asyncHandler(async (req, res) => {
  const policies = await service.listMyPolicies(req.tenant, req.user);
  return ApiResponse.ok(res, policies, 'Your policies retrieved successfully');
});

const getMine = asyncHandler(async (req, res) => {
  const policy = await service.getMyPolicy(req.tenant, req.user, req.params.id);
  return ApiResponse.ok(res, policy, 'Policy retrieved successfully');
});

const acknowledge = asyncHandler(async (req, res) => {
  const ack = await service.acknowledgePolicy(req.tenant, req.user, req.params.id);
  const message = ack.alreadyAcknowledged
    ? 'Policy was already acknowledged'
    : 'Policy acknowledged successfully';
  return ApiResponse.ok(res, ack, message);
});

const listCategories = asyncHandler(async (req, res) => {
  const categories = await service.listCategories(req.tenant);
  return ApiResponse.ok(res, categories, 'Categories retrieved successfully');
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.tenant, req.body);
  return ApiResponse.created(res, category, 'Category created successfully');
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.updateCategory(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, category, 'Category updated successfully');
});

const deleteCategory = asyncHandler(async (req, res) => {
  await service.deleteCategory(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Category deleted successfully');
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded');
  }

  // Construct URL based on env.API_URL and /uploads path
  const url = `${process.env.API_URL || 'http://localhost:5000'}/uploads/logos/${req.file.filename}`;
  
  return ApiResponse.ok(res, { 
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: url 
  }, 'File uploaded successfully');
});

module.exports = {
  list,
  getOne,
  listMine,
  getMine,
  create,
  update,
  remove,
  getTracking,
  acknowledge,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadFile
};
