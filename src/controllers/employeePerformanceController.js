'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { EmployeePerformance } = require('../models/EmployeePerformance');
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
 * POST /api/employee-performance
 * Create a new employee assessment
 */
const createAssessment = asyncHandler(async (req, res) => {
  const {
    employee,
    performanceCycle,
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status
  } = req.body;

  // Validation
  if (!employee) throw ApiError.badRequest('Employee ID is required');
  if (!performanceCycle) throw ApiError.badRequest('Performance Cycle ID is required');
  if (!Array.isArray(competencyRatings) || competencyRatings.length === 0) {
    throw ApiError.badRequest('Competency ratings are required');
  }

  // Validate rating values
  competencyRatings.forEach(cr => {
    if (!cr.competency) {
      throw ApiError.badRequest('Each competency rating must have a competency ID');
    }
    const r = Number(cr.rating);
    if (isNaN(r) || r < 1 || r > 5) {
      throw ApiError.badRequest('Ratings must be numbers between 1 and 5');
    }
  });

  const pool = getTenantDbPool(req.user);

  // Check if assessment already exists for employee and cycle
  const dupCheck = await pool.query(
    `SELECT id FROM employee_performance 
     WHERE employee_id = $1 AND performance_cycle_id = $2 AND deleted_at IS NULL`,
    [employee, performanceCycle]
  );
  if (dupCheck.rows.length > 0) {
    throw ApiError.conflict('An assessment already exists for this employee in the specified performance cycle');
  }

  const assessment = await EmployeePerformance.create(pool, {
    employee,
    performanceCycle,
    competencyRatings,
    keyContributions: keyContributions || '',
    growthObjectives: growthObjectives || '',
    performanceLead: performanceLead || '',
    remarks: remarks || '',
    assessmentDate: assessmentDate || null,
    status: status || 'Completed' // standard submitted assessments are 'Completed' or 'Pending'
  }, req.user.id);

  return ApiResponse.created(res, assessment, 'Employee performance assessment created successfully');
});

/**
 * GET /api/employee-performance
 * Retrieve all employee assessments with optional search, sorting, and pagination
 */
const getAllAssessments = asyncHandler(async (req, res) => {
  const {
    search = '',
    limit = 100,
    page = 1,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const pool = getTenantDbPool(req.user);
  
  const parsedLimit = parseInt(limit, 10) || 100;
  const parsedPage = parseInt(page, 10) || 1;
  const offset = (parsedPage - 1) * parsedLimit;

  const result = await EmployeePerformance.findAll(pool, {
    search,
    limit: parsedLimit,
    offset,
    sortBy,
    sortOrder
  });

  return ApiResponse.ok(res, {
    assessments: result.assessments,
    total: result.total,
    page: parsedPage,
    limit: parsedLimit,
    totalPages: Math.ceil(result.total / parsedLimit)
  }, 'Employee performance assessments retrieved successfully');
});

/**
 * GET /api/employee-performance/summary
 * Retrieve overall review counts/metrics
 */
const getSummaryMetrics = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);
  const metrics = await EmployeePerformance.getSummary(pool);
  return ApiResponse.ok(res, metrics, 'Employee performance summary retrieved successfully');
});

/**
 * GET /api/employee-performance/:id
 * Retrieve a single assessment
 */
const getAssessmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pool = getTenantDbPool(req.user);

  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  const assessment = await EmployeePerformance.findById(pool, assessmentId);
  if (!assessment) throw ApiError.notFound('Assessment not found');

  return ApiResponse.ok(res, assessment, 'Employee performance assessment retrieved successfully');
});

/**
 * PUT /api/employee-performance/:id
 * Update an existing assessment
 */
const updateAssessment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status
  } = req.body;

  const pool = getTenantDbPool(req.user);

  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  // Verify existence
  const existing = await EmployeePerformance.findById(pool, assessmentId);
  if (!existing) throw ApiError.notFound('Assessment not found');

  // Validate rating values if provided
  if (competencyRatings !== undefined) {
    if (!Array.isArray(competencyRatings) || competencyRatings.length === 0) {
      throw ApiError.badRequest('Competency ratings cannot be empty');
    }
    competencyRatings.forEach(cr => {
      if (!cr.competency) {
        throw ApiError.badRequest('Each competency rating must have a competency ID');
      }
      const r = Number(cr.rating);
      if (isNaN(r) || r < 1 || r > 5) {
        throw ApiError.badRequest('Ratings must be numbers between 1 and 5');
      }
    });
  }

  const updated = await EmployeePerformance.update(pool, assessmentId, {
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status
  }, req.user.id);

  return ApiResponse.ok(res, updated, 'Employee performance assessment updated successfully');
});

/**
 * DELETE /api/employee-performance/:id
 * Delete an assessment
 */
const deleteAssessment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pool = getTenantDbPool(req.user);

  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  const success = await EmployeePerformance.deleteById(pool, assessmentId, req.user.id);
  if (!success) throw ApiError.notFound('Assessment not found');

  return ApiResponse.ok(res, null, 'Employee performance assessment deleted successfully');
});

/**
 * GET /api/performance-cycles/dropdown
 * Dropdown of cycles with mongoose-compatible keys (_id, cycleName)
 */
const getCyclesDropdown = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);
  const result = await pool.query(
    `SELECT id, cycle_name FROM performance_cycles 
     WHERE deleted_at IS NULL 
     ORDER BY cycle_name ASC`
  );
  
  const formatted = result.rows.map(row => ({
    _id: row.id,
    id: row.id,
    cycleName: row.cycle_name
  }));

  return ApiResponse.ok(res, formatted, 'Performance cycles dropdown retrieved successfully');
});

/**
 * GET /api/competencies/dropdown
 * Dropdown of competencies with mongoose-compatible keys (_id, competencyName)
 */
const getCompetenciesDropdown = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);
  const result = await pool.query(
    `SELECT id, competency_name FROM competencies 
     WHERE deleted_at IS NULL 
     ORDER BY competency_name ASC`
  );

  const formatted = result.rows.map(row => ({
    _id: row.id,
    id: row.id,
    competencyName: row.competency_name
  }));

  return ApiResponse.ok(res, formatted, 'Competencies dropdown retrieved successfully');
});

/**
 * GET /api/employee-performance/employee/:employeeId
 * Retrieve all assessments for a specific employee
 */
const getAssessmentsByEmployeeId = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const pool = getTenantDbPool(req.user);

  if (!employeeId) throw ApiError.badRequest('Employee ID is required');

  const assessments = await EmployeePerformance.findByEmployeeId(pool, employeeId);

  return ApiResponse.ok(res, assessments, 'Employee assessments retrieved successfully');
});

/**
 * GET /api/employee-performance/performance-summary/:employeeId
 * Retrieve performance summary for a specific employee
 */
const getEmployeePerformanceSummary = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const pool = getTenantDbPool(req.user);

  if (!employeeId) throw ApiError.badRequest('Employee ID is required');

  const summary = await EmployeePerformance.getEmployeeSummary(pool, employeeId);

  return ApiResponse.ok(res, summary, 'Employee performance summary retrieved successfully');
});

module.exports = {
  createAssessment,
  getAllAssessments,
  getSummaryMetrics,
  getAssessmentById,
  updateAssessment,
  deleteAssessment,
  getCyclesDropdown,
  getCompetenciesDropdown,
  getAssessmentsByEmployeeId,
  getEmployeePerformanceSummary
};
