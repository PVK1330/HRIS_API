// src/modules/superadmin/features.repository.js
const { superAdminPool } = require('../../config/db');

class FeaturesRepository {
  async findAll(filters = {}, options = {}) {
    let query = `
      SELECT id, feature_name, feature_code, feature_description, feature_sort_order, feature_is_active, created_at, updated_at
      FROM public.platform_features
      WHERE 1=1
    `;
    let countQuery = `
      SELECT COUNT(*)
      FROM public.platform_features
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (filters.feature_is_active !== undefined) {
      const activeFilter = ` AND feature_is_active = $${paramIndex}`;
      query += activeFilter;
      countQuery += activeFilter;
      params.push(filters.feature_is_active);
      paramIndex++;
    }

    if (filters.search) {
      const searchFilter = ` AND (feature_name ILIKE $${paramIndex} OR feature_code ILIKE $${paramIndex})`;
      query += searchFilter;
      countQuery += searchFilter;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    let totalCount = 0;
    if (options.paginate) {
      const countResult = await superAdminPool.query(countQuery, params);
      totalCount = parseInt(countResult.rows[0].count, 10);
    }

    query += ' ORDER BY feature_sort_order, feature_name';

    if (options.paginate) {
      const limit = options.limit || 10;
      const offset = options.offset || 0;
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
    }

    const result = await superAdminPool.query(query, params);
    
    if (options.paginate) {
      return {
        data: result.rows,
        total: totalCount
      };
    }

    return result.rows;
  }

  async findById(id) {
    const result = await superAdminPool.query(
      `SELECT id, feature_name, feature_code, feature_description, feature_sort_order, feature_is_active, created_at, updated_at
       FROM public.platform_features
       WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  async findByCode(code) {
    const result = await superAdminPool.query(
      `SELECT id, feature_name, feature_code, feature_description, feature_sort_order, feature_is_active, created_at, updated_at
       FROM public.platform_features
       WHERE feature_code = $1`,
      [code]
    );
    return result.rows[0];
  }

  async create(featureData) {
    const {
      feature_name,
      feature_code,
      feature_description,
      feature_sort_order = 0,
      feature_is_active = true
    } = featureData;

    const result = await superAdminPool.query(
      `INSERT INTO public.platform_features (
        feature_name, feature_code, feature_description, feature_sort_order, feature_is_active
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        feature_name,
        feature_code,
        feature_description || null,
        feature_sort_order,
        feature_is_active
      ]
    );
    return result.rows[0];
  }

  async update(id, featureData) {
    const {
      feature_name,
      feature_code,
      feature_description,
      feature_sort_order,
      feature_is_active
    } = featureData;

    const result = await superAdminPool.query(
      `UPDATE public.platform_features
       SET feature_name = COALESCE($1, feature_name),
           feature_code = COALESCE($2, feature_code),
           feature_description = COALESCE($3, feature_description),
           feature_sort_order = COALESCE($4, feature_sort_order),
           feature_is_active = COALESCE($5, feature_is_active),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        feature_name,
        feature_code,
        feature_description,
        feature_sort_order,
        feature_is_active,
        id
      ]
    );
    return result.rows[0];
  }

  async delete(id) {
    const result = await superAdminPool.query(
      `UPDATE public.platform_features
       SET feature_is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  async hardDelete(id) {
    const result = await superAdminPool.query(
      'DELETE FROM public.platform_features WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rowCount > 0;
  }

  async activate(id) {
    const result = await superAdminPool.query(
      `UPDATE public.platform_features
       SET feature_is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  async deactivate(id) {
    const result = await superAdminPool.query(
      `UPDATE public.platform_features
       SET feature_is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }
}

module.exports = new FeaturesRepository();
