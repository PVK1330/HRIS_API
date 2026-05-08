'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse  = require('../../utils/ApiResponse');
const service      = require('./letters.service');

// GET /api/v1/letters/kpis
const getKpis = asyncHandler(async (req, res) => {
  const kpis = await service.getKpis(req.user);
  return ApiResponse.ok(res, kpis, 'KPIs retrieved successfully');
});

// GET /api/v1/letters/templates
const listTemplates = asyncHandler(async (req, res) => {
  const result = await service.listTemplates(req.user, req.query);
  return ApiResponse.ok(res, result, 'Templates retrieved successfully');
});

// GET /api/v1/letters/templates/:id
const getTemplate = asyncHandler(async (req, res) => {
  const template = await service.getTemplate(req.user, req.params.id);
  return ApiResponse.ok(res, { template }, 'Template retrieved successfully');
});

// POST /api/v1/letters/templates
const createTemplate = asyncHandler(async (req, res) => {
  const { name, type, category, description, body, status } = req.body;
  const template = await service.createTemplate(req.user, { name, type, category, description, body, status });
  return ApiResponse.created(res, { template }, 'Template created successfully');
});

// PATCH /api/v1/letters/templates/:id
const updateTemplate = asyncHandler(async (req, res) => {
  const { name, type, category, description, body, status } = req.body;
  const template = await service.updateTemplate(req.user, req.params.id, { name, type, category, description, body, status });
  return ApiResponse.ok(res, { template }, 'Template updated successfully');
});

// DELETE /api/v1/letters/templates/:id
const deleteTemplate = asyncHandler(async (req, res) => {
  await service.deleteTemplate(req.user, req.params.id);
  return ApiResponse.ok(res, null, 'Template deleted successfully');
});

// POST /api/v1/letters/dispatch
const dispatchLetter = asyncHandler(async (req, res) => {
  const { templateId, employeeId, sentBy } = req.body;
  const dispatch = await service.dispatchLetter(req.user, { templateId, employeeId, sentBy });
  return ApiResponse.created(res, { dispatch }, 'Letter dispatched successfully');
});

// GET /api/v1/letters/history
const listHistory = asyncHandler(async (req, res) => {
  const result = await service.listHistory(req.user, req.query);
  return ApiResponse.ok(res, result, 'Dispatch history retrieved successfully');
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

// GET /api/v1/letters/tags
const listTags = asyncHandler(async (req, res) => {
  const tags = await service.listTags(req.user);
  return ApiResponse.ok(res, { tags }, 'Tags retrieved successfully');
});

// POST /api/v1/letters/tags
const createTag = asyncHandler(async (req, res) => {
  const { tag, description } = req.body;
  const created = await service.createTag(req.user, { tag, description });
  return ApiResponse.created(res, { tag: created }, 'Tag created successfully');
});

// PATCH /api/v1/letters/tags/:id
const updateTag = asyncHandler(async (req, res) => {
  const { tag, description } = req.body;
  const updated = await service.updateTag(req.user, req.params.id, { tag, description });
  return ApiResponse.ok(res, { tag: updated }, 'Tag updated successfully');
});

// DELETE /api/v1/letters/tags/:id
const deleteTag = asyncHandler(async (req, res) => {
  await service.deleteTag(req.user, req.params.id);
  return ApiResponse.ok(res, null, 'Tag deleted successfully');
});

module.exports = {
  getKpis,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  dispatchLetter,
  listHistory,
  listTags,
  createTag,
  updateTag,
  deleteTag,
};
