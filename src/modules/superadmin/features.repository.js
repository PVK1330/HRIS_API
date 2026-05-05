// src/modules/superadmin/features.repository.js
const { superadminPool } = require('../../config/db');

class FeaturesRepository {
  /**
   * Get all features
   */
  async findAll(filters = {}) {
    let query = `
      SELECT id, name, code, description, category, is_active, created_at, updated_at
      FROM public.features
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (filters.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filters.isActive);
      paramIndex++;
    }

    if (filters.category) {
      query += ` AND category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    query += ' ORDER BY category, name';

    const result = await superadminPool.query(query, params);
    return result.rows;
  }

  /**
   * Get feature by ID
   */
  async findById(id) {
    const result = await superadminPool.query(
      `SELECT id, name, code, description, category, is_active, created_at, updated_at
       FROM public.features
       WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Get feature by code
   */
  async findByCode(code) {
    const result = await superadminPool.query(
      `SELECT id, name, code, description, category, is_active, created_at, updated_at
       FROM public.features
       WHERE code = $1`,
      [code]
    );
    return result.rows[0];
  }

  /**
   * Get features by category
   */
  async findByCategory(category) {
    const result = await superadminPool.query(
      `SELECT id, name, code, description, category, is_active, created_at, updated_at
       FROM public.features
       WHERE category = $1
       ORDER BY name`,
      [category]
    );
    return result.rows;
  }

  /**
   * Get all categories
   */
  async getCategories() {
    const result = await superadminPool.query(
      `SELECT DISTINCT category
       FROM public.features
       WHERE category IS NOT NULL
       ORDER BY category`
    );
    return result.rows.map(row => row.category);
  }

  /**
   * Create new feature
   */
  async create(featureData) {
    const {
      name,
      code,
      description,
      category,
      isActive = true
    } = featureData;

    const result = await superadminPool.query(
      `INSERT INTO public.features (
        name, code, description, category, is_active
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        name,
        code,
        description || null,
        category || null,
        isActive
      ]
    );
    return result.rows[0];
  }

  /**
   * Update feature
   */
  async update(id, featureData) {
    const {
      name,
      code,
      description,
      category,
      isActive
    } = featureData;

    const result = await superadminPool.query(
      `UPDATE public.features
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           description = COALESCE($3, description),
           category = COALESCE($4, category),
           is_active = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        name,
        code,
        description,
        category,
        isActive,
        id
      ]
    );
    return result.rows[0];
  }

  /**
   * Delete feature (soft delete by setting is_active to false)
   */
  async delete(id) {
    const result = await superadminPool.query(
      `UPDATE public.features
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Hard delete feature
   */
  async hardDelete(id) {
    const result = await superadminPool.query(
      'DELETE FROM public.features WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rowCount > 0;
  }

  /**
   * Activate feature
   */
  async activate(id) {
    const result = await superadminPool.query(
      `UPDATE public.features
       SET is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Deactivate feature
   */
  async deactivate(id) {
    const result = await superadminPool.query(
      `UPDATE public.features
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }
}

module.exports = new FeaturesRepository();
