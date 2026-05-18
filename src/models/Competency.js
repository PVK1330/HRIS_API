'use strict';

/**
 * ============================================================================
 * Competency Model / Schema
 * ============================================================================
 * 
 * Fields:
 * - competencyName:
 *   - type: String
 *   - required: true
 *   - unique: true
 *   - trim: true
 * 
 * Use:
 * - timestamps: true
 * 
 * Implements database queries on PostgreSQL tenant pools.
 * ============================================================================
 */

// Schema definition object for Mongoose / general reference
const CompetencySchema = {
  competencyName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  timestamps: true
};

class Competency {
  constructor(data = {}) {
    this.id = data.id;
    this.competencyName = data.competency_name ? data.competency_name.trim() : '';
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
    this.deletedAt = data.deleted_at;
  }

  /**
   * Create a new competency
   */
  static async create(pool, competencyName, userId) {
    if (!competencyName || !competencyName.trim()) {
      throw new Error('Competency name is required');
    }
    const name = competencyName.trim();

    // Check for duplicate
    const existing = await this.findOneByName(pool, name);
    if (existing) {
      throw new Error('Competency name must be unique');
    }

    const query = `
      INSERT INTO competencies (competency_name, created_by, updated_by, created_at, updated_at)
      VALUES ($1, $2, $2, NOW(), NOW())
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [name, userId]);
    return new Competency(rows[0]);
  }

  /**
   * Find a competency by name
   */
  static async findOneByName(pool, competencyName) {
    const query = `
      SELECT * FROM competencies 
      WHERE LOWER(competency_name) = LOWER($1) AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [competencyName.trim()]);
    return rows[0] ? new Competency(rows[0]) : null;
  }

  /**
   * Find all competencies with optional regex search
   */
  static async findAll(pool, options = {}) {
    const { search = '' } = options;
    let query = `
      SELECT * FROM competencies
      WHERE deleted_at IS NULL
    `;
    const values = [];

    if (search.trim()) {
      query += ` AND competency_name ~* $1`; // case-insensitive regex search in PG!
      values.push(search.trim());
    }

    query += ` ORDER BY created_at DESC;`;

    const { rows } = await pool.query(query, values);
    return rows.map(r => new Competency(r));
  }

  /**
   * Find competency by ID
   */
  static async findById(pool, id) {
    const query = `
      SELECT * FROM competencies WHERE id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] ? new Competency(rows[0]) : null;
  }

  /**
   * Delete competency by ID (soft delete)
   */
  static async deleteById(pool, id, userId) {
    const query = `
      UPDATE competencies
      SET deleted_at = NOW(), updated_by = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id, userId]);
    return rows[0] ? new Competency(rows[0]) : null;
  }

  /**
   * Get Summary Statistics
   */
  static async getSummary(pool) {
    // Total Competencies
    const totalRes = await pool.query(`
      SELECT COUNT(*) as count FROM competencies WHERE deleted_at IS NULL;
    `);
    const totalCompetencies = parseInt(totalRes.rows[0].count, 10);

    // Created This Month
    const thisMonthRes = await pool.query(`
      SELECT COUNT(*) as count FROM competencies 
      WHERE deleted_at IS NULL 
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE);
    `);
    const createdThisMonth = parseInt(thisMonthRes.rows[0].count, 10);

    // Recent Competencies (created in the last 7 days)
    const recentRes = await pool.query(`
      SELECT COUNT(*) as count FROM competencies 
      WHERE deleted_at IS NULL 
        AND created_at >= NOW() - INTERVAL '7 days';
    `);
    const recentCompetencies = parseInt(recentRes.rows[0].count, 10);

    return {
      totalCompetencies,
      createdThisMonth,
      recentCompetencies
    };
  }
}

module.exports = { Competency, CompetencySchema };
