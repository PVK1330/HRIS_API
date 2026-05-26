'use strict';

/**
 * ============================================================================
 * EmployeePerformance Model / Schema
 * ============================================================================
 * 
 * Fields:
 * - employee: ID referencing Employee table (populated as object)
 * - performanceCycle: ID referencing PerformanceCycle table (populated as object)
 * - competencyRatings: Array of { competency: ID, rating: Number }
 * - overallRating: Calculated average of competency ratings
 * - keyContributions: String
 * - growthObjectives: String
 * - performanceBand: Computed based on overall rating
 * - performanceLead: String
 * - status: 'Pending' or 'Completed'
 * 
 * Implements high-performance batched joins and full CRUD over Postgres pool.
 * ============================================================================
 */

const EmployeePerformanceSchema = {
  employee: {
    type: 'ObjectId',
    ref: 'Employee',
    required: true
  },
  performanceCycle: {
    type: 'ObjectId',
    ref: 'PerformanceCycle',
    required: true
  },
  competencyRatings: [
    {
      competency: {
        type: 'ObjectId',
        ref: 'Competency'
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
        required: true
      }
    }
  ],
  overallRating: {
    type: Number,
    min: 1,
    max: 5
  },
  keyContributions: {
    type: String,
    trim: true
  },
  growthObjectives: {
    type: String,
    trim: true
  },
  performanceBand: {
    type: String,
    enum: ['Outstanding', 'Exceeds', 'Meets', 'Needs Improvement']
  },
  performanceLead: {
    type: String
  },
  status: {
    type: String,
    enum: ['Pending', 'Completed'],
    default: 'Pending'
  },
  timestamps: true
};

function calculateOverallRating(competencyRatings) {
  if (!Array.isArray(competencyRatings) || competencyRatings.length === 0) {
    return 0;
  }
  const sum = competencyRatings.reduce((acc, curr) => acc + Number(curr.rating || 0), 0);
  return Math.round((sum / competencyRatings.length) * 100) / 100;
}

function calculatePerformanceBand(overallRating) {
  if (overallRating >= 4.5 && overallRating <= 5) {
    return 'Outstanding';
  } else if (overallRating >= 4.0 && overallRating < 4.5) {
    return 'Exceeds';
  } else if (overallRating >= 3.0 && overallRating < 4.0) {
    return 'Meets';
  } else {
    return 'Needs Improvement';
  }
}

class EmployeePerformance {
  constructor(data = {}) {
    this.id = data.id;
    this.employeeId = data.employee_id;
    this.departmentId = data.department_id;
    this.performanceCycleId = data.performance_cycle_id;
    this.managerId = data.manager_id;
    this.competencyRatings = data.competency_ratings || [];
    this.overallRating = data.overall_rating ? Number(data.overall_rating) : 0;
    this.keyContributions = data.key_contributions || '';
    this.growthObjectives = data.growth_objectives || '';
    this.performanceBand = data.performance_band || '';
    this.performanceLead = data.performance_lead || '';
    this.remarks = data.remarks || '';
    this.assessmentDate = data.assessment_date;
    this.status = data.status || 'Pending';
    this.goalTitle = data.goal_title || '';
    this.kpiTarget = data.kpi_target || '';
    this.weightage = data.weightage || null;
    this.dueDate = data.due_date || null;
    this.priority = data.priority || '';
    this.managerStatus = data.manager_status || '';
    this.employeeStatus = data.employee_status || 'Not Started';
    this.employeeProgress = data.employee_progress || '0';
    this.employeeComments = data.employee_comments || '';
    this.completionNotes = data.completion_notes || '';
    this.employeeUpdatedAt = data.employee_updated_at;
    this.approvedBy = data.approved_by;
    this.approvedAt = data.approved_at;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
    this.deletedAt = data.deleted_at;
  }

  /**
   * Batched Populate JOIN helper to fetch referenced objects efficiently without N+1 queries.
   */
  static async populate(pool, rows) {
    if (!rows || rows.length === 0) return [];

    const empIds = [...new Set(rows.map(r => r.employee_id).filter(Boolean))];
    const cycleIds = [...new Set(rows.map(r => r.performance_cycle_id).filter(Boolean))];

    const competencyIds = new Set();
    rows.forEach(r => {
      const crs = Array.isArray(r.competency_ratings) ? r.competency_ratings : [];
      crs.forEach(cr => {
        if (cr.competency) competencyIds.add(Number(cr.competency));
      });
    });

    // Fetch Employees
    let employeesMap = {};
    if (empIds.length > 0) {
      const empRes = await pool.query(
        `SELECT id, emp_id, full_name FROM employees WHERE id = ANY($1)`,
        [empIds]
      );
      empRes.rows.forEach(e => {
        employeesMap[e.id] = { id: e.id, empId: e.emp_id, fullName: e.full_name };
      });
    }

    const deptIds = [...new Set(rows.map(r => r.department_id).filter(Boolean))];
    let deptsMap = {};
    if (deptIds.length > 0) {
      const deptRes = await pool.query(
        `SELECT id, name FROM departments WHERE id = ANY($1)`,
        [deptIds]
      );
      deptRes.rows.forEach(d => {
        deptsMap[d.id] = { id: d.id, name: d.name };
      });
    }

    const mgrIds = [...new Set(rows.map(r => r.manager_id).filter(Boolean))];
    let mgrsMap = {};
    if (mgrIds.length > 0) {
      const mgrRes = await pool.query(
        `SELECT id, emp_id, full_name FROM employees WHERE id = ANY($1)`,
        [mgrIds]
      );
      mgrRes.rows.forEach(m => {
        mgrsMap[m.id] = { id: m.id, empId: m.emp_id, fullName: m.full_name };
      });
    }

    // Fetch Cycles
    let cyclesMap = {};
    if (cycleIds.length > 0) {
      const cycleRes = await pool.query(
        `SELECT id, cycle_name FROM performance_cycles WHERE id = ANY($1)`,
        [cycleIds]
      );
      cycleRes.rows.forEach(c => {
        cyclesMap[c.id] = { id: c.id, cycleName: c.cycle_name };
      });
    }

    // Fetch Competencies
    let competenciesMap = {};
    const compIdsArr = [...competencyIds];
    if (compIdsArr.length > 0) {
      const compRes = await pool.query(
        `SELECT id, competency_name FROM competencies WHERE id = ANY($1)`,
        [compIdsArr]
      );
      compRes.rows.forEach(c => {
        competenciesMap[c.id] = { id: c.id, competencyName: c.competency_name };
      });
    }

    // Assemble populated objects
    return rows.map(r => {
      const crs = Array.isArray(r.competency_ratings) ? r.competency_ratings : [];
      const competencyRatingsPopulated = crs.map(cr => ({
        competency: competenciesMap[cr.competency] || { id: cr.competency, competencyName: 'Unknown Competency' },
        rating: Number(cr.rating)
      }));

      return {
        id: r.id,
        assessmentId: r.id,
        employeeId: r.employee_id,
        departmentId: r.department_id,
        performanceCycleId: r.performance_cycle_id,
        managerId: r.manager_id,
        employee: employeesMap[r.employee_id] || { id: r.employee_id, empId: '', fullName: 'Unknown Employee' },
        department: deptsMap[r.department_id] || { id: r.department_id, name: 'Unknown Department' },
        performanceCycle: cyclesMap[r.performance_cycle_id] || { id: r.performance_cycle_id, cycleName: 'Unknown Cycle' },
        manager: mgrsMap[r.manager_id] || { id: r.manager_id, fullName: 'Unknown Manager' },
        employeeName: employeesMap[r.employee_id] ? employeesMap[r.employee_id].fullName : 'Unknown Employee',
        departmentName: deptsMap[r.department_id] ? deptsMap[r.department_id].name : 'Unknown Department',
        managerName: mgrsMap[r.manager_id] ? mgrsMap[r.manager_id].fullName : (r.performance_lead || 'Unknown Manager'),
        performanceCycleName: cyclesMap[r.performance_cycle_id] ? cyclesMap[r.performance_cycle_id].cycleName : 'Unknown Cycle',
        competencyRatings: competencyRatingsPopulated,
        overallRating: r.overall_rating ? Number(r.overall_rating) : 0,
        keyContributions: r.key_contributions || '',
        growthObjectives: r.growth_objectives || '',
        performanceBand: r.performance_band || '',
        performanceLead: r.performance_lead || '',
        remarks: r.remarks || '',
        assessmentDate: r.assessment_date,
        goalTitle: r.goal_title || '',
        kpiTarget: r.kpi_target || '',
        weightage: r.weightage || null,
        dueDate: r.due_date || null,
        priority: r.priority || '',
        managerStatus: r.manager_status || '',
        employeeStatus: r.employee_status || 'Not Started',
        employeeProgress: r.employee_progress || '0',
        employeeComments: r.employee_comments || '',
        completionNotes: r.completion_notes || '',
        employeeUpdatedAt: r.employee_updated_at,
        status: r.status || 'Pending',
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });
  }

  /**
   * Create assessment
   */
  static async create(pool, assessmentData, userId) {
    const {
      employeeId,
      departmentId,
      performanceCycleId,
      managerId,
      employee,
      performanceCycle,
      competencyRatings = [],
      keyContributions = '',
      growthObjectives = '',
      performanceLead = '',
      remarks = '',
      assessmentDate = null,
      status = 'Completed',
      goalTitle = '',
      kpiTarget = '',
      weightage = null,
      dueDate = null,
      priority = '',
      managerStatus = ''
    } = assessmentData;

    const overallRating = calculateOverallRating(competencyRatings);
    const performanceBand = calculatePerformanceBand(overallRating);

    const query = `
      INSERT INTO employee_performance (
        employee_id,
        department_id,
        performance_cycle_id,
        manager_id,
        competency_ratings,
        overall_rating,
        key_contributions,
        growth_objectives,
        performance_band,
        performance_lead,
        remarks,
        assessment_date,
        status,
        goal_title,
        kpi_target,
        weightage,
        due_date,
        priority,
        manager_status,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20, NOW(), NOW())
      RETURNING *;
    `;

    const empIdToUse = employeeId || employee;
    const cycleIdToUse = performanceCycleId || performanceCycle;

    const values = [
      empIdToUse,
      departmentId || null,
      cycleIdToUse,
      managerId || null,
      JSON.stringify(competencyRatings),
      overallRating,
      keyContributions.trim(),
      growthObjectives.trim(),
      performanceBand,
      performanceLead.trim(),
      remarks.trim(),
      assessmentDate,
      status,
      goalTitle.trim(),
      kpiTarget.trim(),
      weightage || null,
      dueDate || null,
      priority.trim(),
      managerStatus.trim(),
      userId
    ];

    const { rows } = await pool.query(query, values);
    const populated = await this.populate(pool, [rows[0]]);
    return populated[0];
  }

  /**
   * Find all assessments with optional search, pagination, and sorting
   */
  static async findAll(pool, options = {}) {
    const {
      search = '',
      limit = 100,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    let query = `
      SELECT ep.*, e.full_name as emp_name, e.emp_id as emp_code
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
    `;

    const values = [];
    let paramCount = 1;

    // Search by employee name, employee ID (emp_id), or performance lead
    if (search.trim()) {
      query += ` AND (
        LOWER(e.full_name) LIKE LOWER($${paramCount}) OR
        LOWER(e.emp_id) LIKE LOWER($${paramCount}) OR
        LOWER(ep.performance_lead) LIKE LOWER($${paramCount})
      )`;
      values.push(`%${search.trim()}%`);
      paramCount++;
    }

    // Validate and whitelist sorting fields
    const validSortFields = {
      'created_at': 'ep.created_at',
      'updated_at': 'ep.updated_at',
      'overall_rating': 'ep.overall_rating',
      'employee_name': 'e.full_name',
      'performance_lead': 'ep.performance_lead'
    };
    const sortField = validSortFields[sortBy] || 'ep.created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${order} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    // Get total count query
    let countQuery = `
      SELECT COUNT(*) as total
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
    `;
    const countValues = [];
    if (search.trim()) {
      countQuery += ` AND (
        LOWER(e.full_name) LIKE LOWER($1) OR
        LOWER(e.emp_id) LIKE LOWER($1) OR
        LOWER(ep.performance_lead) LIKE LOWER($1)
      )`;
      countValues.push(`%${search.trim()}%`);
    }

    const [listRes, countRes] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues)
    ]);

    const populatedList = await this.populate(pool, listRes.rows);
    return {
      assessments: populatedList,
      total: parseInt(countRes.rows[0].total, 10)
    };
  }

  /**
   * Find assessments assigned to a manager
   */
  static async findByManagerId(pool, managerId, options = {}) {
    const {
      search = '',
      limit = 100,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    let query = `
      SELECT ep.*
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
        AND ep.manager_id = $1
    `;
    const values = [managerId];
    let paramCount = 2;

    if (search.trim()) {
      query += ` AND (
        LOWER(e.full_name) LIKE LOWER($${paramCount}) OR
        LOWER(e.emp_id) LIKE LOWER($${paramCount}) OR
        LOWER(ep.performance_lead) LIKE LOWER($${paramCount})
      )`;
      values.push(`%${search.trim()}%`);
      paramCount++;
    }

    const validSortFields = {
      'created_at': 'ep.created_at',
      'updated_at': 'ep.updated_at',
      'overall_rating': 'ep.overall_rating',
      'employee_name': 'e.full_name',
      'performance_lead': 'ep.performance_lead'
    };
    const sortField = validSortFields[sortBy] || 'ep.created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${order} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    let countQuery = `
      SELECT COUNT(*) as total
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
        AND ep.manager_id = $1
    `;
    const countValues = [managerId];
    if (search.trim()) {
      countQuery += ` AND (
        LOWER(e.full_name) LIKE LOWER($2) OR
        LOWER(e.emp_id) LIKE LOWER($2) OR
        LOWER(ep.performance_lead) LIKE LOWER($2)
      )`;
      countValues.push(`%${search.trim()}%`);
    }

    const [listRes, countRes] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues)
    ]);

    const populatedList = await this.populate(pool, listRes.rows);
    return {
      assessments: populatedList,
      total: parseInt(countRes.rows[0].total, 10)
    };
  }

  /**
   * Find single assessment by ID
   */
  static async findById(pool, id) {
    const query = `
      SELECT * FROM employee_performance
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return null;

    const populated = await this.populate(pool, [rows[0]]);
    return populated[0];
  }

  /**
   * Update assessment
   */
  static async update(pool, id, updateData, userId) {
    const existing = await this.findById(pool, id);
    if (!existing) return null;

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
    } = updateData;

    const setClause = [];
    const values = [];
    let paramCount = 1;

    if (departmentId !== undefined) {
      setClause.push(`department_id = $${paramCount}`);
      values.push(departmentId);
      paramCount++;
    }

    if (managerId !== undefined) {
      setClause.push(`manager_id = $${paramCount}`);
      values.push(managerId);
      paramCount++;
    }

    // Recalculate overall rating and band if competency ratings are updated
    let calculatedRating = null;
    let calculatedBand = null;

    if (competencyRatings !== undefined) {
      calculatedRating = calculateOverallRating(competencyRatings);
      calculatedBand = calculatePerformanceBand(calculatedRating);

      setClause.push(`competency_ratings = $${paramCount}::jsonb`);
      values.push(JSON.stringify(competencyRatings));
      paramCount++;

      setClause.push(`overall_rating = $${paramCount}`);
      values.push(calculatedRating);
      paramCount++;

      setClause.push(`performance_band = $${paramCount}`);
      values.push(calculatedBand);
      paramCount++;
    }

    if (keyContributions !== undefined) {
      setClause.push(`key_contributions = $${paramCount}`);
      values.push(keyContributions.trim());
      paramCount++;
    }

    if (growthObjectives !== undefined) {
      setClause.push(`growth_objectives = $${paramCount}`);
      values.push(growthObjectives.trim());
      paramCount++;
    }

    if (performanceLead !== undefined) {
      setClause.push(`performance_lead = $${paramCount}`);
      values.push(performanceLead.trim());
      paramCount++;
    }

    if (remarks !== undefined) {
      setClause.push(`remarks = $${paramCount}`);
      values.push(remarks.trim());
      paramCount++;
    }

    if (assessmentDate !== undefined) {
      setClause.push(`assessment_date = $${paramCount}`);
      values.push(assessmentDate);
      paramCount++;
    }

    if (status !== undefined) {
      setClause.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }

    if (goalTitle !== undefined) {
      setClause.push(`goal_title = $${paramCount}`);
      values.push(goalTitle ? goalTitle.trim() : '');
      paramCount++;
    }

    if (kpiTarget !== undefined) {
      setClause.push(`kpi_target = $${paramCount}`);
      values.push(kpiTarget ? kpiTarget.trim() : '');
      paramCount++;
    }

    if (weightage !== undefined) {
      setClause.push(`weightage = $${paramCount}`);
      values.push(weightage !== null && weightage !== '' ? Number(weightage) : null);
      paramCount++;
    }

    if (dueDate !== undefined) {
      setClause.push(`due_date = $${paramCount}`);
      values.push(dueDate || null);
      paramCount++;
    }

    if (priority !== undefined) {
      setClause.push(`priority = $${paramCount}`);
      values.push(priority ? priority.trim() : '');
      paramCount++;
    }

    if (managerStatus !== undefined) {
      setClause.push(`manager_status = $${paramCount}`);
      values.push(managerStatus ? managerStatus.trim() : '');
      paramCount++;
    }

    // Audit updated fields
    setClause.push(`updated_by = $${paramCount}`);
    values.push(userId);
    paramCount++;

    setClause.push(`updated_at = NOW()`);

    if (setClause.length === 2) { // only updated_by and updated_at
      return existing;
    }

    values.push(id);

    const query = `
      UPDATE employee_performance
      SET ${setClause.join(', ')}
      WHERE id = $${paramCount} AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return null;

    const populated = await this.populate(pool, [rows[0]]);
    return populated[0];
  }

  /**
   * Soft Delete
   */
  static async deleteById(pool, id, userId) {
    const query = `
      UPDATE employee_performance
      SET deleted_at = NOW(), updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id, userId]);
    return rows[0] ? true : false;
  }

  /**
   * Summary metrics
   */
  static async getSummary(pool) {
    const query = `
      SELECT 
        COUNT(*) as total_assessments,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_reviews,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_reviews
      FROM employee_performance
      WHERE deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query);
    const data = rows[0] || {};
    return {
      totalAssessments: parseInt(data.total_assessments || 0, 10),
      pendingReview: parseInt(data.pending_reviews || 0, 10),
      completed: parseInt(data.completed_reviews || 0, 10)
    };
  }

  /**
   * Find all assessments for a specific employee
   */
  static async findByEmployeeId(pool, employeeId) {
    const query = `
      SELECT * FROM employee_performance
      WHERE employee_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(query, [employeeId]);
    return await this.populate(pool, rows);
  }

  /**
   * Get employee performance summary
   */
  static async getEmployeeSummary(pool, employeeId) {
    const query = `
      SELECT * FROM employee_performance
      WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Completed'
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(query, [employeeId]);
    
    const totalAssessments = rows.length;
    let averageRating = 0;
    let performanceRatio = 0;
    let currentCycleRating = 0;
    let latestStatus = 'N/A';
    
    if (totalAssessments > 0) {
      const sumRatings = rows.reduce((acc, curr) => acc + Number(curr.overall_rating || 0), 0);
      averageRating = Math.round((sumRatings / totalAssessments) * 100) / 100;
      performanceRatio = Math.round((averageRating / 5) * 100);
      currentCycleRating = Number(rows[0].overall_rating || 0);
      latestStatus = rows[0].performance_band || 'N/A';
    }

    const allAssessmentsQuery = `
      SELECT COUNT(*) as total
      FROM employee_performance
      WHERE employee_id = $1 AND deleted_at IS NULL;
    `;
    const allRes = await pool.query(allAssessmentsQuery, [employeeId]);
    const totalAllAssessments = parseInt(allRes.rows[0].total, 10);

    return {
      totalAssessments: totalAllAssessments,
      completedCycles: totalAssessments,
      averageRating,
      performanceRatio,
      currentCycleRating,
      latestPerformanceStatus: latestStatus
    };
  }

  /**
   * Update only manager goal fields by manager
   * Ensures only the assigned manager can update their own goal details
   */
  static async updateManagerGoals(pool, id, managerId, goalData, userId) {
    const {
      goalTitle,
      kpiTarget,
      weightage,
      dueDate,
      priority,
      managerStatus
    } = goalData;

    // First verify the assessment exists and manager is assigned
    const query = `
      SELECT id, manager_id FROM employee_performance
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [id]);
    
    if (rows.length === 0) return null;
    
    // Verify the logged-in manager is the assigned manager
    if (Number(rows[0].manager_id) !== Number(managerId)) {
      return null; // Manager mismatch - unauthorized
    }

    // Update only manager goal fields
    const setClause = [];
    const values = [];
    let paramCount = 1;

    if (goalTitle !== undefined) {
      setClause.push(`goal_title = $${paramCount}`);
      values.push(goalTitle || null);
      paramCount++;
    }

    if (kpiTarget !== undefined) {
      setClause.push(`kpi_target = $${paramCount}`);
      values.push(kpiTarget || null);
      paramCount++;
    }

    if (weightage !== undefined) {
      setClause.push(`weightage = $${paramCount}`);
      values.push(weightage !== null && weightage !== undefined ? parseInt(weightage, 10) : null);
      paramCount++;
    }

    if (dueDate !== undefined) {
      setClause.push(`due_date = $${paramCount}`);
      values.push(dueDate || null);
      paramCount++;
    }

    if (priority !== undefined) {
      setClause.push(`priority = $${paramCount}`);
      values.push(priority || null);
      paramCount++;
    }

    if (managerStatus !== undefined) {
      setClause.push(`manager_status = $${paramCount}`);
      values.push(managerStatus || null);
      paramCount++;
    }

    // Audit fields
    setClause.push(`updated_by = $${paramCount}`);
    values.push(userId);
    paramCount++;

    setClause.push(`updated_at = NOW()`);

    if (setClause.length === 2) { // only updated_by and updated_at
      const existing = await this.findById(pool, id);
      return existing;
    }

    values.push(id);
    values.push(managerId);

    const updateQuery = `
      UPDATE employee_performance
      SET ${setClause.join(', ')}
      WHERE id = $${paramCount} AND manager_id = $${paramCount + 1} AND deleted_at IS NULL
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, values);
    if (updateResult.rows.length === 0) return null;

    const populated = await this.populate(pool, [updateResult.rows[0]]);
    return populated[0];
  }

  /**
   * Find assessments with manager goal details (for admin view)
   */
  static async findAllWithManagerGoals(pool, options = {}) {
    const {
      search = '',
      limit = 100,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    let query = `
      SELECT ep.*
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
    `;

    const values = [];
    let paramCount = 1;

    if (search.trim()) {
      query += ` AND (
        LOWER(e.full_name) LIKE LOWER($${paramCount}) OR
        LOWER(e.emp_id) LIKE LOWER($${paramCount}) OR
        LOWER(ep.performance_lead) LIKE LOWER($${paramCount})
      )`;
      values.push(`%${search.trim()}%`);
      paramCount++;
    }

    const validSortFields = {
      'created_at': 'ep.created_at',
      'updated_at': 'ep.updated_at',
      'overall_rating': 'ep.overall_rating',
      'employee_name': 'e.full_name',
      'performance_lead': 'ep.performance_lead'
    };
    const sortField = validSortFields[sortBy] || 'ep.created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${order} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
    `;
    const countValues = [];
    if (search.trim()) {
      countQuery += ` AND (
        LOWER(e.full_name) LIKE LOWER($1) OR
        LOWER(e.emp_id) LIKE LOWER($1) OR
        LOWER(ep.performance_lead) LIKE LOWER($1)
      )`;
      countValues.push(`%${search.trim()}%`);
    }

    const [listRes, countRes] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues)
    ]);

    const populatedList = await this.populate(pool, listRes.rows);
    return {
      assessments: populatedList,
      total: parseInt(countRes.rows[0].total, 10)
    };
  }

  /**
   * Find assessments with manager goal details only (for Manager Goals table)
   */
  static async findAssessmentsWithManagerGoals(pool, options = {}) {
    const {
      search = '',
      limit = 100,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    let query = `
      SELECT ep.*
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
        AND (ep.goal_title IS NOT NULL OR ep.kpi_target IS NOT NULL)
    `;

    const values = [];
    let paramCount = 1;

    if (search.trim()) {
      query += ` AND (
        LOWER(e.full_name) LIKE LOWER($${paramCount}) OR
        LOWER(e.emp_id) LIKE LOWER($${paramCount}) OR
        LOWER(ep.goal_title) LIKE LOWER($${paramCount})
      )`;
      values.push(`%${search.trim()}%`);
      paramCount++;
    }

    const validSortFields = {
      'created_at': 'ep.created_at',
      'updated_at': 'ep.updated_at',
      'goal_title': 'ep.goal_title',
      'weightage': 'ep.weightage',
      'priority': 'ep.priority'
    };
    const sortField = validSortFields[sortBy] || 'ep.created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${order} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM employee_performance ep
      LEFT JOIN employees e ON ep.employee_id = e.id
      WHERE ep.deleted_at IS NULL
        AND (ep.goal_title IS NOT NULL OR ep.kpi_target IS NOT NULL)
    `;
    const countValues = [];
    if (search.trim()) {
      countQuery += ` AND (
        LOWER(e.full_name) LIKE LOWER($1) OR
        LOWER(e.emp_id) LIKE LOWER($1) OR
        LOWER(ep.goal_title) LIKE LOWER($1)
      )`;
      countValues.push(`%${search.trim()}%`);
    }

    const [listRes, countRes] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues)
    ]);

    const populatedList = await this.populate(pool, listRes.rows);
    return {
      assessments: populatedList,
      total: parseInt(countRes.rows[0].total, 10)
    };
  }

  /**
   * Update employee progress fields only (by Employee)
   */
  static async updateEmployeeProgress(pool, id, employeeId, progressData, userId) {
    const {
      employeeStatus,
      employeeProgress,
      employeeComments,
      completionNotes
    } = progressData;

    // Verify assessment exists and belongs to the employee
    const query = `
      SELECT id, employee_id FROM employee_performance
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [id]);
    
    if (rows.length === 0) return null;
    
    if (Number(rows[0].employee_id) !== Number(employeeId)) {
      return null; // Employee mismatch - unauthorized
    }

    const setClause = [];
    const values = [];
    let paramCount = 1;

    if (employeeStatus !== undefined) {
      setClause.push(`employee_status = $${paramCount}`);
      values.push(employeeStatus);
      paramCount++;
    }

    if (employeeProgress !== undefined) {
      setClause.push(`employee_progress = $${paramCount}`);
      values.push(String(employeeProgress));
      paramCount++;
    }

    if (employeeComments !== undefined) {
      setClause.push(`employee_comments = $${paramCount}`);
      values.push(employeeComments.trim());
      paramCount++;
    }

    if (completionNotes !== undefined) {
      setClause.push(`completion_notes = $${paramCount}`);
      values.push(completionNotes.trim());
      paramCount++;
    }

    setClause.push(`employee_updated_at = NOW()`);
    
    // Also audit updated_by and updated_at
    setClause.push(`updated_by = $${paramCount}`);
    values.push(userId);
    paramCount++;
    setClause.push(`updated_at = NOW()`);

    if (setClause.length === 3) { // no actual progress fields updated
      const existing = await this.findById(pool, id);
      return existing;
    }

    values.push(id);
    values.push(employeeId);

    const updateQuery = `
      UPDATE employee_performance
      SET ${setClause.join(', ')}
      WHERE id = $${paramCount} AND employee_id = $${paramCount + 1} AND deleted_at IS NULL
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, values);
    if (updateResult.rows.length === 0) return null;

    const populated = await this.populate(pool, [updateResult.rows[0]]);
    return populated[0];
  }

  /**
   * Approve an assessment (admin only)
   * Records approval details and updates employee status to 'Approved'
   */
  static async approve(pool, id, userId) {
    const existing = await this.findById(pool, id);
    if (!existing) return null;

    const updateQuery = `
      UPDATE employee_performance
      SET 
        employee_status = 'Approved',
        approved_by = $1,
        approved_at = NOW(),
        updated_by = $1,
        updated_at = NOW()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [userId, id]);
    if (result.rows.length === 0) return null;

    const populated = await this.populate(pool, [result.rows[0]]);
    return populated[0];
  }
}

module.exports = { EmployeePerformance, EmployeePerformanceSchema };
