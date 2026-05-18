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
    this.performanceCycleId = data.performance_cycle_id;
    this.competencyRatings = data.competency_ratings || [];
    this.overallRating = data.overall_rating ? Number(data.overall_rating) : 0;
    this.keyContributions = data.key_contributions || '';
    this.growthObjectives = data.growth_objectives || '';
    this.performanceBand = data.performance_band || '';
    this.performanceLead = data.performance_lead || '';
    this.status = data.status || 'Pending';
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
        employee: employeesMap[r.employee_id] || { id: r.employee_id, empId: '', fullName: 'Unknown Employee' },
        performanceCycle: cyclesMap[r.performance_cycle_id] || { id: r.performance_cycle_id, cycleName: 'Unknown Cycle' },
        competencyRatings: competencyRatingsPopulated,
        overallRating: r.overall_rating ? Number(r.overall_rating) : 0,
        keyContributions: r.key_contributions || '',
        growthObjectives: r.growth_objectives || '',
        performanceBand: r.performance_band || '',
        performanceLead: r.performance_lead || '',
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
      employee,
      performanceCycle,
      competencyRatings = [],
      keyContributions = '',
      growthObjectives = '',
      performanceLead = '',
      status = 'Completed' // default to Completed for submitted assessments, or let user set it
    } = assessmentData;

    const overallRating = calculateOverallRating(competencyRatings);
    const performanceBand = calculatePerformanceBand(overallRating);

    const query = `
      INSERT INTO employee_performance (
        employee_id,
        performance_cycle_id,
        competency_ratings,
        overall_rating,
        key_contributions,
        growth_objectives,
        performance_band,
        performance_lead,
        status,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $10, NOW(), NOW())
      RETURNING *;
    `;

    const values = [
      employee,
      performanceCycle,
      JSON.stringify(competencyRatings),
      overallRating,
      keyContributions.trim(),
      growthObjectives.trim(),
      performanceBand,
      performanceLead.trim(),
      status,
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
      competencyRatings,
      keyContributions,
      growthObjectives,
      performanceLead,
      status
    } = updateData;

    const setClause = [];
    const values = [];
    let paramCount = 1;

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

    if (status !== undefined) {
      setClause.push(`status = $${paramCount}`);
      values.push(status);
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
      pendingReviews: parseInt(data.pending_reviews || 0, 10),
      completedReviews: parseInt(data.completed_reviews || 0, 10)
    };
  }
}

module.exports = { EmployeePerformance, EmployeePerformanceSchema };
