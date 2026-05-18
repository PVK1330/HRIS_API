'use strict';

/**
 * ============================================================================
 * Performance Cycles Controller
 * ============================================================================
 * Handles HTTP request/response logic:
 * - Processes incoming requests
 * - Calls service layer
 * - Returns formatted responses
 * - Handles errors gracefully
 * ============================================================================
 */

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./performanceCycles.service');

/**
 * POST /api/v1/performance-cycles
 * Create a new performance cycle
 * 
 * Request body:
 * {
 *   cycleName: string (required),
 *   startDate: ISO date string (required),
 *   endDate: ISO date string (required),
 *   submissionDeadline: ISO date string (required),
 *   automatedReminder: boolean (optional, default: false)
 * }
 * 
 * Response: 201 Created
 * {
 *   success: true,
 *   message: "Performance cycle created successfully",
 *   data: { id, cycleName, startDate, endDate, ... }
 * }
 */
const createCycle = asyncHandler(async (req, res) => {
  const cycleData = {
    cycleName: req.body.cycleName,
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    submissionDeadline: req.body.submissionDeadline,
    automatedReminder: req.body.automatedReminder || false,
  };

  const cycle = await service.createCycle(req.user, cycleData);

  return ApiResponse.created(res, cycle, 'Performance cycle created successfully');
});

/**
 * GET /api/v1/performance-cycles
 * Retrieve all performance cycles with optional search and filters
 * 
 * Query parameters:
 * - search (string): Search by cycle name
 * - status (string): Filter by status (ACTIVE, UPCOMING, COMPLETED)
 * - page (number): Page number (default: 1)
 * - limit (number): Records per page (default: 10)
 * 
 * Example: /api/v1/performance-cycles?search=q1&status=ACTIVE&page=1&limit=10
 * 
 * Response: 200 OK
 * {
 *   success: true,
 *   message: "Performance cycles retrieved successfully",
 *   data: {
 *     cycles: [...],
 *     total: number,
 *     page: number,
 *     totalPages: number
 *   }
 * }
 */
const getAllCycles = asyncHandler(async (req, res) => {
  const {
    search = '',
    status = null,
    page = 1,
    limit = 10,
  } = req.query;

  const data = await service.getAllCycles(req.user, {
    search,
    status,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });

  return ApiResponse.ok(res, data, 'Performance cycles retrieved successfully');
});

/**
 * GET /api/v1/performance-cycles/:id
 * Retrieve a single performance cycle by ID
 * 
 * Response: 200 OK
 * {
 *   success: true,
 *   message: "Performance cycle retrieved successfully",
 *   data: { id, cycleName, startDate, endDate, ... }
 * }
 */
const getCycleById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const cycle = await service.getCycleById(req.user, parseInt(id, 10));

  return ApiResponse.ok(res, cycle, 'Performance cycle retrieved successfully');
});

/**
 * PUT /api/v1/performance-cycles/:id
 * Update a performance cycle
 * 
 * Request body (all fields optional):
 * {
 *   cycleName: string,
 *   startDate: ISO date string,
 *   endDate: ISO date string,
 *   submissionDeadline: ISO date string,
 *   automatedReminder: boolean
 * }
 * 
 * Response: 200 OK
 * {
 *   success: true,
 *   message: "Performance cycle updated successfully",
 *   data: { id, cycleName, startDate, endDate, ... }
 * }
 */
const updateCycle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const updateData = {};
  
  // Only include fields that are provided in the request
  if (req.body.cycleName !== undefined) updateData.cycleName = req.body.cycleName;
  if (req.body.startDate !== undefined) updateData.startDate = req.body.startDate;
  if (req.body.endDate !== undefined) updateData.endDate = req.body.endDate;
  if (req.body.submissionDeadline !== undefined) updateData.submissionDeadline = req.body.submissionDeadline;
  if (req.body.automatedReminder !== undefined) updateData.automatedReminder = req.body.automatedReminder;

  const cycle = await service.updateCycle(req.user, parseInt(id, 10), updateData);

  return ApiResponse.ok(res, cycle, 'Performance cycle updated successfully');
});

/**
 * DELETE /api/v1/performance-cycles/:id
 * Delete a performance cycle (soft delete)
 * 
 * Response: 200 OK
 * {
 *   success: true,
 *   message: "Performance cycle deleted successfully",
 *   data: { id, cycleName, ... }
 * }
 */
const deleteCycle = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const cycle = await service.deleteCycle(req.user, parseInt(id, 10));

  return ApiResponse.ok(res, cycle, 'Performance cycle deleted successfully');
});

/**
 * GET /api/v1/performance-cycles/summary
 * Get summary statistics of performance cycles
 * 
 * Response: 200 OK
 * {
 *   success: true,
 *   message: "Performance cycles summary retrieved successfully",
 *   data: {
 *     activeCycles: number,
 *     upcomingCycles: number,
 *     completedCycles: number
 *   }
 * }
 */
const getSummary = asyncHandler(async (req, res) => {
  const summary = await service.getCyclesSummary(req.user);

  return ApiResponse.ok(res, summary, 'Performance cycles summary retrieved successfully');
});

module.exports = {
  createCycle,
  getAllCycles,
  getCycleById,
  updateCycle,
  deleteCycle,
  getSummary,
};
