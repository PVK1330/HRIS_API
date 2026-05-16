'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./documents.service');

// GET /api/v1/employees/:employeeId/documents/catalog
const listCatalog = asyncHandler(async (req, res) => {
  const data = await service.listCatalogTypes(req.user, req.params.employeeId, req.auth);
  return ApiResponse.ok(res, data, 'Document types retrieved successfully');
});

// GET /api/v1/employees/:employeeId/documents
const list = asyncHandler(async (req, res) => {
  const data = await service.getDocuments(req.user, req.params.employeeId, req.auth);
  return ApiResponse.ok(res, data, 'Documents retrieved successfully');
});

// POST /api/v1/employees/:employeeId/documents
const create = asyncHandler(async (req, res) => {
  const data = await service.createDocument(
    req.user,
    req.params.employeeId,
    req.body,
    req.file,
    req.auth,
  );
  return ApiResponse.ok(res, data, 'Document uploaded successfully');
});

module.exports = { listCatalog, list, create };
