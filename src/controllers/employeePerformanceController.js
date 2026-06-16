'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { EmployeePerformance } = require('../models/EmployeePerformance');
const { getTenantPool } = require('../config/db');
const notify = require('../modules/notifications/notifications.service');
const logger = require('../utils/logger');
const { P, permissionSatisfied } = require('../constants/permissions');

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
 * Endpoints under `/employee/:employeeId` are reachable with the self-only
 * `performance.view.own` permission. Unless the caller also holds the broad
 * `performance.view` (or is a tenant admin), restrict them to their own record
 * so one employee cannot read a colleague's performance data via the path param.
 */
function assertCanViewEmployeePerformance(req, employeeId) {
  const auth = req.auth;
  const canViewAny = auth && (auth.isTenantAdmin || permissionSatisfied(auth.permissions, P.PERFORMANCE_VIEW));
  if (canViewAny) return;

  const self = req.user.employeeId || req.user.employee_id;
  if (!self || Number(self) !== Number(employeeId)) {
    throw ApiError.forbidden('You can only view your own performance data');
  }
}

/**
 * POST /api/employee-performance
 * Create a new employee assessment
 */
const createAssessment = asyncHandler(async (req, res) => {
  const {
    employeeId,
    departmentId,
    performanceCycleId,
    managerId,
    employee,
    performanceCycle,
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status,
    goalTitle,
    kpiTarget,
    weightage,
    dueDate,
    priority,
    managerStatus
  } = req.body;

  const empIdToUse = employeeId || employee;
  const cycleIdToUse = performanceCycleId || performanceCycle;

  // Validation
  if (!empIdToUse) throw ApiError.badRequest('Employee ID is required');
  if (!cycleIdToUse) throw ApiError.badRequest('Performance Cycle ID is required');
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
    [empIdToUse, cycleIdToUse]
  );
  if (dupCheck.rows.length > 0) {
    throw ApiError.conflict('An assessment already exists for this employee in the specified performance cycle');
  }

  const assessment = await EmployeePerformance.create(pool, {
    employeeId,
    departmentId,
    performanceCycleId,
    managerId,
    employee,
    performanceCycle,
    competencyRatings,
    keyContributions: keyContributions || '',
    growthObjectives: growthObjectives || '',
    performanceLead: performanceLead || '',
    remarks: remarks || '',
    assessmentDate: assessmentDate || null,
    status: status || 'Completed', // standard submitted assessments are 'Completed' or 'Pending'
    goalTitle,
    kpiTarget,
    weightage,
    dueDate,
    priority,
    managerStatus
  }, req.user.id);

  // Notify the employee (and their manager) that an assessment was assigned
  const tenant = { db_name: req.user.db_name };
  const cycleLabel = performanceCycle || assessment?.performanceCycle?.cycleName || 'the current cycle';
  if (empIdToUse) {
    notify.sendSystemNotification(tenant, {
      employeeId: Number(empIdToUse),
      title: 'New Performance Assessment Assigned',
      message: `A performance assessment has been assigned to you for ${cycleLabel}.`,
      type: 'info',
      entityType: 'employee_performance',
      entityId: assessment.id,
      redirectUrl: '/admin/employee-profile',
    }).catch(() => null);
  }
  if (managerId) {
    notify.sendSystemNotification(tenant, {
      employeeId: Number(managerId),
      title: 'Performance Assessment Awaiting Goals',
      message: `An assessment was assigned to your team member for ${cycleLabel}. Please set their goals and KPIs.`,
      type: 'info',
      entityType: 'employee_performance',
      entityId: assessment.id,
      redirectUrl: '/admin/manager-performance',
    }).catch(() => null);
  }

  return ApiResponse.created(res, assessment, 'Employee performance assessment created successfully');

});

/**
 * GET /api/employee-performance
 * Retrieve all employee assessments with optional search, sorting, and pagination
 */
const getAllAssessments = asyncHandler(async (req, res) => {
  const {
    search = '',
    limit = 20,
    page = 1,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const pool = getTenantDbPool(req.user);

  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
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
    pagination: {
      total: result.total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(result.total / parsedLimit)
    }
  }, 'Employee performance assessments retrieved successfully');
});

/**
 * GET /api/v1/manager/performance/reviews
 * Retrieve assessments assigned to the logged-in manager
 */

const getManagerReviewList = asyncHandler(async (req, res) => {
  const {
    search = '',
    limit = 20,
    page = 1,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const pool = getTenantDbPool(req.user);
  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (parsedPage - 1) * parsedLimit;

  const managerEmployeeId = req.user.employeeId || req.user.employee_id || req.user.id;

  logger.debug('[performance] manager filter', { managerEmployeeId });

  const result = await EmployeePerformance.findByManagerId(pool, managerEmployeeId, {
    search,
    limit: parsedLimit,
    offset,
    sortBy,
    sortOrder
  });

  return ApiResponse.ok(res, {
    assessments: result.assessments,
    pagination: {
      total: result.total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(result.total / parsedLimit)
    }
  }, 'Manager performance reviews retrieved successfully');
});

/**
 * GET /api/v1/manager/performance/reviews/:id
 * Retrieve a specific review assigned to the logged-in manager
 */
const getManagerReviewById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // manager_id stores the manager's employee id, not the account id — match the
  // convention used by findByManagerId / updateManagerGoals.
  const managerId = req.user.employeeId || req.user.employee_id || req.user.id;
  const pool = getTenantDbPool(req.user);

  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  const assessment = await EmployeePerformance.findById(pool, assessmentId);
  if (!assessment) throw ApiError.notFound('Assessment not found');
  if (Number(assessment.managerId) !== Number(managerId)) {
    throw ApiError.forbidden('You do not have access to this assessment');
  }

  return ApiResponse.ok(res, assessment, 'Manager performance review retrieved successfully');
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
 * GET /api/employee-performance/analytics
 * Aggregated, tenant-scoped analytics for the Performance Reports dashboard.
 */
const getPerformanceAnalytics = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);

  // Optional filters to scope the analytics for large tenants
  const { cycleId, departmentId } = req.query;
  const parsedCycleId = cycleId ? parseInt(cycleId, 10) : null;
  const parsedDeptId = departmentId ? parseInt(departmentId, 10) : null;

  // Build reusable WHERE fragment
  const baseWhere = [];
  const baseParams = [];
  if (parsedCycleId) {
    baseParams.push(parsedCycleId);
    baseWhere.push(`ep.performance_cycle_id = $${baseParams.length}`);
  }
  if (parsedDeptId) {
    baseParams.push(parsedDeptId);
    baseWhere.push(`ep.department_id = $${baseParams.length}`);
  }

  const baseFilter = baseWhere.length
    ? `AND ${baseWhere.join(' AND ')}`
    : '';

  const [byDeptRes, bandRes, statusRes, cycleRatingRes, summaryRes] = await Promise.all([
    // Assessments per department (cap at 15)
    pool.query(`
      SELECT COALESCE(d.name, 'Unassigned') AS name, COUNT(ep.id)::int AS value
      FROM employee_performance ep
      LEFT JOIN departments d ON d.id = ep.department_id AND d.deleted_at IS NULL
      WHERE ep.deleted_at IS NULL ${baseFilter}
      GROUP BY COALESCE(d.name, 'Unassigned')
      ORDER BY value DESC
      LIMIT 15;
    `, baseParams),
    // Distribution by performance band
    pool.query(`
      SELECT COALESCE(performance_band, 'Unrated') AS name, COUNT(*)::int AS count
      FROM employee_performance ep
      WHERE ep.deleted_at IS NULL ${baseFilter}
      GROUP BY COALESCE(performance_band, 'Unrated')
      ORDER BY count DESC;
    `, baseParams),
    // Distribution by employee execution status
    pool.query(`
      SELECT COALESCE(employee_status, 'Not Started') AS name, COUNT(*)::int AS count
      FROM employee_performance ep
      WHERE ep.deleted_at IS NULL ${baseFilter}
      GROUP BY COALESCE(employee_status, 'Not Started')
      ORDER BY count DESC;
    `, baseParams),
    // Average overall rating per recent cycle (last 6)
    pool.query(`
      SELECT pc.cycle_name AS cycle,
             ROUND(AVG(ep.overall_rating)::numeric, 2)::float AS rate
      FROM employee_performance ep
      JOIN performance_cycles pc ON pc.id = ep.performance_cycle_id
      WHERE ep.deleted_at IS NULL AND ep.overall_rating IS NOT NULL ${baseFilter}
      GROUP BY pc.id, pc.cycle_name, pc.start_date
      ORDER BY pc.start_date DESC NULLS LAST
      LIMIT 6;
    `, baseParams),
    // Headline metrics
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        ROUND(AVG(overall_rating)::numeric, 2)::float AS avg_rating,
        COUNT(*) FILTER (WHERE employee_status = 'Completed')::int AS completed,
        COUNT(*) FILTER (WHERE employee_status = 'Approved')::int AS approved
      FROM employee_performance ep
      WHERE ep.deleted_at IS NULL ${baseFilter};
    `, baseParams),
  ]);

  const summaryRow = summaryRes.rows[0] || {};

  const analytics = {
    byDepartment: byDeptRes.rows,
    performanceDist: bandRes.rows,
    byStatus: statusRes.rows,
    // Oldest → newest so the trend reads left to right
    ratingTrend: cycleRatingRes.rows.slice().reverse(),
    summary: {
      total: summaryRow.total || 0,
      avgRating: summaryRow.avg_rating || 0,
      completed: summaryRow.completed || 0,
      approved: summaryRow.approved || 0,
    },
  };

  return ApiResponse.ok(res, analytics, 'Performance analytics retrieved successfully');
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
    departmentId,
    managerId,
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status,
    goalTitle,
    kpiTarget,
    weightage,
    dueDate,
    priority,
    managerStatus
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
    departmentId,
    managerId,
    competencyRatings,
    keyContributions,
    growthObjectives,
    performanceLead,
    remarks,
    assessmentDate,
    status,
    goalTitle,
    kpiTarget,
    weightage,
    dueDate,
    priority,
    managerStatus
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
  assertCanViewEmployeePerformance(req, employeeId);

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
  assertCanViewEmployeePerformance(req, employeeId);

  const summary = await EmployeePerformance.getEmployeeSummary(pool, employeeId);

  return ApiResponse.ok(res, summary, 'Employee performance summary retrieved successfully');
});

/**
 * PATCH /api/v1/performance-assessments/:id/manager-goals
 * Manager updates their own goal details for an assigned assessment
 */
const updateManagerGoals = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    goalTitle,
    kpiTarget,
    weightage,
    dueDate,
    priority,
    managerStatus
  } = req.body;

  // Validation
  if (!goalTitle || !goalTitle.trim()) {
    throw ApiError.badRequest('Goal Title is required');
  }
  if (!kpiTarget || !kpiTarget.trim()) {
    throw ApiError.badRequest('KPI / Target is required');
  }
  if (!weightage || isNaN(parseInt(weightage, 10)) || parseInt(weightage, 10) < 1 || parseInt(weightage, 10) > 100) {
    throw ApiError.badRequest('Weightage is required and must be between 1 and 100');
  }
  if (!dueDate || !dueDate.trim()) {
    throw ApiError.badRequest('Due Date is required');
  }
  if (!priority || !priority.trim()) {
    throw ApiError.badRequest('Priority is required');
  }
  if (!managerStatus || !managerStatus.trim()) {
    throw ApiError.badRequest('Manager Status is required');
  }

  const pool = getTenantDbPool(req.user);
  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  // Get manager employee ID
  const managerEmployeeId = req.user.employeeId || req.user.employee_id || req.user.id;

  // Update manager goals
  const updated = await EmployeePerformance.updateManagerGoals(pool, assessmentId, managerEmployeeId, {
    goalTitle: goalTitle.trim(),
    kpiTarget: kpiTarget.trim(),
    weightage: parseInt(weightage, 10),
    dueDate,
    priority: priority.trim(),
    managerStatus: managerStatus.trim()
  }, req.user.id);

  if (!updated) {
    throw ApiError.notFound('Assessment not found or you do not have access to it');
  }

  // Notify the employee that their manager has set/updated goals
  if (updated.employeeId) {
    notify.sendSystemNotification({ db_name: req.user.db_name }, {
      employeeId: Number(updated.employeeId),
      title: 'Performance Goals Updated',
      message: `Your manager has set goals for "${goalTitle.trim()}". Review them and start tracking your progress.`,
      type: 'info',
      entityType: 'employee_performance',
      entityId: updated.id,
      redirectUrl: '/admin/employee-profile',
    }).catch(() => null);
  }

  return ApiResponse.ok(res, updated, 'Manager goal details updated successfully');
});

/**
 * GET /api/v1/performance-assessments/manager
 * Retrieve assessments assigned to the logged-in manager (Manager Portal)
 */
const getManagerAssignedAssessments = asyncHandler(async (req, res) => {
  const {
    search = '',
    limit = 20,
    page = 1,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = req.query;

  const pool = getTenantDbPool(req.user);
  const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (parsedPage - 1) * parsedLimit;

  const managerEmployeeId = req.user.employeeId || req.user.employee_id || req.user.id;

  logger.debug('[performance] getManagerAssignedAssessments', { managerEmployeeId });

  const result = await EmployeePerformance.findByManagerId(pool, managerEmployeeId, {
    search,
    limit: parsedLimit,
    offset,
    sortBy,
    sortOrder
  });

  return ApiResponse.ok(res, {
    assessments: result.assessments,
    pagination: {
      total: result.total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(result.total / parsedLimit)
    }
  }, 'Manager assigned assessments retrieved successfully');
});

/**
 * GET /api/v1/manager/department
 * Retrieve the department assigned to the logged-in manager
 */
const getManagerDepartment = asyncHandler(async (req, res) => {
  const pool = getTenantDbPool(req.user);
  const managerId = req.user.employeeId || req.user.employee_id;

  if (!managerId) {
    throw ApiError.badRequest('Employee ID not found in user context');
  }

  const { rows } = await pool.query(
    `SELECT 
       d.id,
       d.name,
       d.code,
       d.description,
       d.manager_id,
       COUNT(e.id) as employee_count
     FROM departments d
     LEFT JOIN employees e ON e.department_id = d.id AND e.deleted_at IS NULL
     WHERE d.manager_id = $1 AND d.deleted_at IS NULL
     GROUP BY d.id, d.name, d.code, d.description, d.manager_id
     LIMIT 1`,
    [managerId]
  );

  if (!rows[0]) {
    return ApiResponse.ok(res, { department: null }, 'No department assigned to this manager');
  }

  const department = {
    id: rows[0].id,
    name: rows[0].name,
    code: rows[0].code,
    description: rows[0].description,
    managerId: rows[0].manager_id,
    employeeCount: parseInt(rows[0].employee_count, 10)
  };

  return ApiResponse.ok(res, { department }, 'Manager department retrieved successfully');
});

/**
 * PUT /api/employee-performance/employee/:id/progress
 * Employee updates their own progress on an assessment
 */
const updateEmployeeProgress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    employeeStatus,
    employeeProgress,
    employeeComments,
    completionNotes
  } = req.body;

  // Validation
  if (employeeProgress !== undefined) {
    if (typeof employeeProgress !== 'string' && typeof employeeProgress !== 'number') {
      throw ApiError.badRequest('Progress percentage must be a string or number');
    }
  }

  const pool = getTenantDbPool(req.user);
  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  // Get employee ID
  const employeeId = req.user.employeeId || req.user.employee_id || req.user.id;

  const updated = await EmployeePerformance.updateEmployeeProgress(pool, assessmentId, employeeId, {
    employeeStatus,
    employeeProgress,
    employeeComments,
    completionNotes
  }, req.user.id);

  if (!updated) {
    throw ApiError.notFound('Assessment not found or you do not have permission to update it');
  }

  // When the employee marks their goal as Completed, alert admins/HR for review
  if (String(updated.employeeStatus) === 'Completed') {
    notify.sendSystemNotification({ db_name: req.user.db_name }, {
      forAdmin: true,
      title: 'Performance Goal Completed',
      message: `${updated.employee?.fullName || 'An employee'} has marked their performance goal as completed and it is ready for review.`,
      type: 'info',
      entityType: 'employee_performance',
      entityId: updated.id,
      redirectUrl: '/admin/performance',
    }).catch(() => null);
  }

  return ApiResponse.ok(res, updated, 'Employee progress updated successfully');
});

/**
 * PATCH /api/employee-performance/:id/approve
 * Admin approves an assessment
 * Updates employee_status to 'Approved'
 */
const approveAssessment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pool = getTenantDbPool(req.user);

  const assessmentId = parseInt(id, 10);
  if (isNaN(assessmentId)) throw ApiError.badRequest('Invalid assessment ID');

  // Verify assessment exists
  const existing = await EmployeePerformance.findById(pool, assessmentId);
  if (!existing) throw ApiError.notFound('Assessment not found');

  // Guard: a user cannot approve their own performance assessment
  const approverEmployeeId = req.user.employeeId || req.user.employee_id;
  if (approverEmployeeId && Number(existing.employeeId) === Number(approverEmployeeId)) {
    throw ApiError.forbidden('You cannot approve your own performance assessment');
  }

  // Approve the assessment
  const approved = await EmployeePerformance.approve(pool, assessmentId, req.user.id);
  if (!approved) throw ApiError.internalServerError('Failed to approve assessment');

  // Notify the employee that their assessment has been approved
  const subjectEmployeeId = approved.employeeId || existing.employeeId;
  if (subjectEmployeeId) {
    notify.sendSystemNotification({ db_name: req.user.db_name }, {
      employeeId: Number(subjectEmployeeId),
      title: 'Performance Assessment Approved',
      message: 'Your performance assessment has been reviewed and approved.',
      type: 'success',
      entityType: 'employee_performance',
      entityId: approved.id,
      redirectUrl: '/admin/employee-profile',
    }).catch(() => null);
  }

  return ApiResponse.ok(res, approved, 'Assessment approved successfully');
});

module.exports = {
  createAssessment,
  getAllAssessments,
  getSummaryMetrics,
  getPerformanceAnalytics,
  getAssessmentById,
  updateAssessment,
  deleteAssessment,
  approveAssessment,
  getCyclesDropdown,
  getCompetenciesDropdown,
  getAssessmentsByEmployeeId,
  getEmployeePerformanceSummary,
  getManagerReviewList,
  getManagerReviewById,
  updateManagerGoals,
  getManagerAssignedAssessments,
  getManagerDepartment,
  updateEmployeeProgress
};
