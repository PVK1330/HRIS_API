'use strict';

const asyncHandler = require('../../../utils/asyncHandler');
const ApiResponse  = require('../../../utils/ApiResponse');
const service      = require('./documents.service');

// GET /api/v1/employees/:employeeId/documents
const list = asyncHandler(async (req, res) => {
  const data = await service.getDocuments(req.user, req.params.employeeId);
  return ApiResponse.ok(res, data, 'Documents retrieved successfully');
});

module.exports = { list };
