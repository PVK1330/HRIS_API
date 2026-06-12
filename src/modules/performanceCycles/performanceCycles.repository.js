'use strict';

/**
 * ============================================================================
 * Performance Cycles Repository
 * ============================================================================
 * Handles all database operations for performance cycles including:
 * - Creating new performance cycles
 * - Retrieving cycles with filtering and search
 * - Updating cycle details
 * - Deleting cycles (soft delete)
 * - Computing cycle status automatically
 * ============================================================================
 */

const logger = require('../../utils/logger');

/**
 * Calculate status based on current date and cycle dates
 * @param {Date} startDate - Cycle start date
 * @param {Date} endDate - Cycle end date
 * @returns {string} - Status: UPCOMING, ACTIVE, or COMPLETED
 */
function calculateStatus(startDate, endDate) {
  const now = new Date();
  
  if (now < new Date(startDate)) {
    return 'UPCOMING';
  } else if (now >= new Date(startDate) && now <= new Date(endDate)) {
    return 'ACTIVE';
  } else {
    return 'COMPLETED';
  }
}

/**
 * Calculate completion percentage based on cycle dates
 * @param {Date} startDate - Cycle start date
 * @param {Date} endDate - Cycle end date
 * @returns {number} - Completion percentage (0-100)
 */
function calculateCompletion(startDate, endDate) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (now < start) {
    return 0;
  } else if (now > end) {
    return 100;
  } else {
    const total = end.getTime() - start.getTime();
    const elapsed = now.getTime() - start.getTime();
    return Math.round((elapsed / total) * 100);
  }
}

/**
 * Create a new performance cycle
 * @param {Pool} pool - Database pool connection
 * @param {Object} cycleData - Cycle data
 * @param {number} userId - User ID for audit trail
 * @returns {Object} - Created cycle with ID
 */
async function create(pool, cycleData, userId) {
  const {
    cycleName,
    startDate,
    endDate,
    submissionDeadline,
    automatedReminder = false,
  } = cycleData;

  // Calculate status and completion automatically
  const status = calculateStatus(startDate, endDate);
  const completionPercentage = calculateCompletion(startDate, endDate);

  const query = `
    INSERT INTO performance_cycles (
      cycle_name,
      start_date,
      end_date,
      submission_deadline,
      automated_reminder,
      status,
      completion_percentage,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    RETURNING *;
  `;

  const values = [
    cycleName,
    startDate,
    endDate,
    submissionDeadline,
    automatedReminder,
    status,
    completionPercentage,
    userId,
    userId,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Find all performance cycles with optional search and filter
 * @param {Pool} pool - Database pool connection
 * @param {Object} options - Query options
 * @param {string} options.search - Search term for cycle name
 * @param {string} options.status - Filter by status (ACTIVE, UPCOMING, COMPLETED)
 * @param {number} options.limit - Pagination limit
 * @param {number} options.offset - Pagination offset
 * @returns {Object} - { cycles, total }
 */
async function findAll(pool, options = {}) {
  const { search = '', status = null, limit = 100, offset = 0 } = options;

  let query = `
    SELECT
      id,
      cycle_name,
      start_date,
      end_date,
      submission_deadline,
      automated_reminder,
      CASE
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END AS status,
      CASE
        WHEN NOW() < start_date THEN 0
        WHEN NOW() > end_date THEN 100
        ELSE ROUND(((EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM start_date)) /
                   (EXTRACT(EPOCH FROM end_date) - EXTRACT(EPOCH FROM start_date))) * 100)
      END AS completion_percentage,
      created_at,
      updated_at,
      created_by
    FROM performance_cycles
    WHERE deleted_at IS NULL
  `;

  const values = [];
  let paramCount = 1;

  // Add search filter for cycle name
  if (search.trim()) {
    query += ` AND LOWER(cycle_name) LIKE LOWER($${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  // Add status filter — compare against the dynamically computed status expression
  if (status && ['ACTIVE', 'UPCOMING', 'COMPLETED'].includes(status)) {
    query += ` AND CASE
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END = $${paramCount}`;
    values.push(status);
    paramCount++;
  }

  // Add ordering and pagination
  query += ` ORDER BY start_date DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  values.push(limit, offset);

  // Get total count
  let countQuery = `
    SELECT COUNT(*) as total
    FROM performance_cycles
    WHERE deleted_at IS NULL
  `;

  const countValues = [];
  let countParamCount = 1;

  if (search.trim()) {
    countQuery += ` AND LOWER(cycle_name) LIKE LOWER($${countParamCount})`;
    countValues.push(`%${search}%`);
    countParamCount++;
  }

  if (status && ['ACTIVE', 'UPCOMING', 'COMPLETED'].includes(status)) {
    countQuery += ` AND CASE
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END = $${countParamCount}`;
    countValues.push(status);
  }

  const [cyclesResult, countResult] = await Promise.all([
    pool.query(query, values),
    pool.query(countQuery, countValues),
  ]);

  return {
    cycles: cyclesResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
  };
}

/**
 * Find a performance cycle by ID
 * @param {Pool} pool - Database pool connection
 * @param {number} id - Cycle ID
 * @returns {Object} - Performance cycle data
 */
async function findById(pool, id) {
  const query = `
    SELECT
      id,
      cycle_name,
      start_date,
      end_date,
      submission_deadline,
      automated_reminder,
      CASE
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END AS status,
      CASE
        WHEN NOW() < start_date THEN 0
        WHEN NOW() > end_date THEN 100
        ELSE ROUND(((EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM start_date)) /
                   (EXTRACT(EPOCH FROM end_date) - EXTRACT(EPOCH FROM start_date))) * 100)
      END AS completion_percentage,
      created_at,
      updated_at,
      created_by
    FROM performance_cycles
    WHERE id = $1 AND deleted_at IS NULL;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Update a performance cycle
 * @param {Pool} pool - Database pool connection
 * @param {number} id - Cycle ID
 * @param {Object} updateData - Data to update
 * @param {number} userId - User ID for audit trail
 * @returns {Object} - Updated cycle data
 */
async function update(pool, id, updateData, userId) {
  const {
    cycleName,
    startDate,
    endDate,
    submissionDeadline,
    automatedReminder,
  } = updateData;

  // Calculate new status and completion
  const status = startDate && endDate ? calculateStatus(startDate, endDate) : null;
  const completionPercentage = startDate && endDate ? calculateCompletion(startDate, endDate) : null;

  // Build dynamic update query
  const setClause = [];
  const values = [];
  let paramCount = 1;

  if (cycleName !== undefined) {
    setClause.push(`cycle_name = $${paramCount}`);
    values.push(cycleName);
    paramCount++;
  }

  if (startDate !== undefined) {
    setClause.push(`start_date = $${paramCount}`);
    values.push(startDate);
    paramCount++;
  }

  if (endDate !== undefined) {
    setClause.push(`end_date = $${paramCount}`);
    values.push(endDate);
    paramCount++;
  }

  if (submissionDeadline !== undefined) {
    setClause.push(`submission_deadline = $${paramCount}`);
    values.push(submissionDeadline);
    paramCount++;
  }

  if (automatedReminder !== undefined) {
    setClause.push(`automated_reminder = $${paramCount}`);
    values.push(automatedReminder);
    paramCount++;
  }

  // Always update status and completion if dates are provided
  if (status !== null) {
    setClause.push(`status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }

  if (completionPercentage !== null) {
    setClause.push(`completion_percentage = $${paramCount}`);
    values.push(completionPercentage);
    paramCount++;
  }

  // Add updated_by
  setClause.push(`updated_by = $${paramCount}`);
  values.push(userId);
  paramCount++;

  if (setClause.length === 1) {
    // Only updated_by, nothing to update
    return findById(pool, id);
  }

  values.push(id);

  const query = `
    UPDATE performance_cycles
    SET ${setClause.join(', ')}
    WHERE id = $${paramCount} AND deleted_at IS NULL
    RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

/**
 * Soft delete a performance cycle
 * @param {Pool} pool - Database pool connection
 * @param {number} id - Cycle ID
 * @param {number} userId - User ID for audit trail
 * @returns {Object} - Deleted cycle data
 */
async function softDelete(pool, id, userId) {
  const query = `
    UPDATE performance_cycles
    SET deleted_at = NOW(), updated_by = $1
    WHERE id = $2 AND deleted_at IS NULL
    RETURNING *;
  `;

  const result = await pool.query(query, [userId, id]);
  return result.rows[0] || null;
}

/**
 * Get summary statistics of performance cycles
 * @param {Pool} pool - Database pool connection
 * @returns {Object} - { activeCycles, upcomingCycles, completedCycles }
 */
async function getSummary(pool) {
  const query = `
    SELECT
      CASE
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END AS status,
      COUNT(*) as count
    FROM performance_cycles
    WHERE deleted_at IS NULL
    GROUP BY 1;
  `;

  const result = await pool.query(query);
  
  const summary = {
    activeCycles: 0,
    upcomingCycles: 0,
    completedCycles: 0,
  };

  result.rows.forEach((row) => {
    if (row.status === 'ACTIVE') {
      summary.activeCycles = parseInt(row.count, 10);
    } else if (row.status === 'UPCOMING') {
      summary.upcomingCycles = parseInt(row.count, 10);
    } else if (row.status === 'COMPLETED') {
      summary.completedCycles = parseInt(row.count, 10);
    }
  });

  return summary;
}

/**
 * Update all cycle statuses based on current date
 * This function should be called periodically via a cron job
 * @param {Pool} pool - Database pool connection
 * @returns {number} - Number of updated records
 */
async function refreshAllStatuses(pool) {
  const query = `
    UPDATE performance_cycles
    SET 
      status = CASE 
        WHEN NOW() < start_date THEN 'UPCOMING'
        WHEN NOW() >= start_date AND NOW() <= end_date THEN 'ACTIVE'
        ELSE 'COMPLETED'
      END,
      completion_percentage = CASE
        WHEN NOW() < start_date THEN 0
        WHEN NOW() > end_date THEN 100
        ELSE ROUND(((EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM start_date)) / 
                   (EXTRACT(EPOCH FROM end_date) - EXTRACT(EPOCH FROM start_date))) * 100)
      END,
      updated_at = NOW()
    WHERE deleted_at IS NULL;
  `;

  const result = await pool.query(query);
  return result.rowCount;
}

module.exports = {
  create,
  findAll,
  findById,
  update,
  softDelete,
  getSummary,
  refreshAllStatuses,
  calculateStatus,
  calculateCompletion,
};
