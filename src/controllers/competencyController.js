'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { Competency } = require('../models/Competency');
const { getTenantPool } = require('../config/db');

/**
 * Get tenant database pool with validation
 */
function getTenantDbPool(user) {
  if (!user?.db_name) {
    throw ApiError.unauthorized('Tenant not found');
  }
  return getTenantPool(user.db_name);
}

/**
 * POST /api/competencies
 * Create a new competency
 */
const createCompetency = asyncHandler(async (req, res) => {
  const { competencyName } = req.body;

  // Validate empty competency name
  if (!competencyName || !competencyName.trim()) {
    throw ApiError.badRequest('Competency name is required');
  }

  const pool = getTenantDbPool(req.user);
  const name = competencyName.trim();

  // Prevent duplicate competency names
  const existing = await Competency.findOneByName(pool, name);
  if (existing) {
    throw ApiError.conflict('Competency name already exists');
  }

  const competency = await Competency.create(pool, name, req.user.id);

  // Formatting for direct React client use
  const formatted = {
    id: competency.id,
    name: competency.competencyName,
    createdAt: competency.createdAt ? new Date(competency.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  };

  return ApiResponse.created(res, formatted, 'Competency created successfully');
});

/**
 * GET /api/competencies
 * Get all competencies (latest created first, support regex search)
 */
const getAllCompetencies = asyncHandler(async (req, res) => {
  const { search = '' } = req.query;
  const pool = getTenantDbPool(req.user);

  const competencies = await Competency.findAll(pool, { search });

  // Map to the frontend expected format (id, name, createdAt)
  const formatted = competencies.map(c => ({
    id: c.id,
    name: c.competencyName,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : null
  }));

  return ApiResponse.ok(res, formatted, 'Competencies retrieved successfully');
});

/**
 * PUT /api/competencies/:id
 * Update a competency's name
 */
const updateCompetency = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { competencyName } = req.body;

  if (!competencyName || !competencyName.trim()) {
    throw ApiError.badRequest('Competency name is required');
  }

  const pool = getTenantDbPool(req.user);
  const competencyId = parseInt(id, 10);
  if (isNaN(competencyId)) {
    throw ApiError.badRequest('Invalid competency ID');
  }

  const existing = await Competency.findById(pool, competencyId);
  if (!existing) {
    throw ApiError.notFound('Competency not found');
  }

  const name = competencyName.trim();

  // Prevent renaming to a name already used by another competency
  const dup = await Competency.findOneByName(pool, name);
  if (dup && dup.id !== competencyId) {
    throw ApiError.conflict('Competency name already exists');
  }

  const updated = await Competency.update(pool, competencyId, name, req.user.id);

  const formatted = {
    id: updated.id,
    name: updated.competencyName,
    createdAt: updated.createdAt ? new Date(updated.createdAt).toISOString().split('T')[0] : null,
  };

  return ApiResponse.ok(res, formatted, 'Competency updated successfully');
});

/**
 * DELETE /api/competencies/:id
 * Delete a selected competency
 */
const deleteCompetency = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pool = getTenantDbPool(req.user);

  const competencyId = parseInt(id, 10);
  if (isNaN(competencyId)) {
    throw ApiError.badRequest('Invalid competency ID');
  }

  const existing = await Competency.findById(pool, competencyId);
  if (!existing) {
    throw ApiError.notFound('Competency not found');
  }

  await Competency.deleteById(pool, competencyId, req.user.id);

  return ApiResponse.ok(res, null, 'Competency deleted successfully');
});

/**
 * GET /api/competencies/summary
 * Get competency summary statistics
 */
const getSummary = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);
  const summary = await Competency.getSummary(pool);

  return ApiResponse.ok(res, summary, 'Competency summary retrieved successfully');
});

module.exports = {
  createCompetency,
  getAllCompetencies,
  updateCompetency,
  deleteCompetency,
  getSummary,
};
