// src/modules/superadmin/plans.repository.js
const { superadminPool } = require('../../config/db');

class PlansRepository {
  /**
   * Get all subscription plans
   */
  async findAll(filters = {}) {
    let query = `
      SELECT id, plan_name, plan_code, plan_description, monthly_price, annual_price, user_quota,
             storage_quota_gb, company_quota, trial_days, support_level, is_popular, is_custom, is_active, created_at, updated_at
      FROM public.subscription_plans
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (filters.isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(filters.isActive);
      paramIndex++;
    }

    query += ' ORDER BY monthly_price ASC';

    const result = await superadminPool.query(query, params);
    return result.rows;
  }

  /**
   * Get plan by ID
   */
  async findById(id) {
    const result = await superadminPool.query(
      `SELECT id, plan_name, plan_code, plan_description, monthly_price, annual_price, user_quota,
              storage_quota_gb, company_quota, trial_days, support_level, is_popular, is_custom, is_active, created_at, updated_at
       FROM public.subscription_plans
       WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Get plan by code
   */
  async findByCode(code) {
    const result = await superadminPool.query(
      `SELECT id, plan_name, plan_code, plan_description, monthly_price, annual_price, user_quota,
              storage_quota_gb, company_quota, trial_days, support_level, is_popular, is_custom, is_active, created_at, updated_at
       FROM public.subscription_plans
       WHERE plan_code = $1`,
      [code]
    );
    return result.rows[0];
  }

  /**
   * Create new subscription plan
   */
  async create(planData) {
    const {
      plan_name,
      plan_code,
      plan_description,
      monthly_price,
      annual_price,
      user_quota,
      storage_quota_gb,
      company_quota,
      trial_days,
      support_level,
      is_popular = false,
      is_custom = false,
      isActive = true
    } = planData;

    const result = await superadminPool.query(
      `INSERT INTO public.subscription_plans (
        plan_name, plan_code, plan_description, monthly_price, annual_price,
        user_quota, storage_quota_gb, company_quota, trial_days, support_level,
        is_popular, is_custom, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        plan_name,
        plan_code,
        plan_description || null,
        monthly_price || 0,
        annual_price || 0,
        user_quota || 0,
        storage_quota_gb || 0,
        company_quota || 1,
        trial_days || 0,
        support_level || null,
        is_popular,
        is_custom,
        isActive
      ]
    );
    return result.rows[0];
  }

  /**
   * Update subscription plan
   */
  async update(id, planData) {
    const {
      plan_name,
      plan_code,
      plan_description,
      monthly_price,
      annual_price,
      user_quota,
      storage_quota_gb,
      company_quota,
      trial_days,
      support_level,
      is_popular,
      is_custom,
      isActive
    } = planData;

    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET plan_name = COALESCE($1, plan_name),
           plan_code = COALESCE($2, plan_code),
           plan_description = COALESCE($3, plan_description),
           monthly_price = COALESCE($4, monthly_price),
           annual_price = COALESCE($5, annual_price),
           user_quota = COALESCE($6, user_quota),
           storage_quota_gb = COALESCE($7, storage_quota_gb),
           company_quota = COALESCE($8, company_quota),
           trial_days = COALESCE($9, trial_days),
           support_level = COALESCE($10, support_level),
           is_popular = COALESCE($11, is_popular),
           is_custom = COALESCE($12, is_custom),
           is_active = COALESCE($13, is_active),
           updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        plan_name,
        plan_code,
        plan_description,
        monthly_price,
        annual_price,
        user_quota,
        storage_quota_gb,
        company_quota,
        trial_days,
        support_level,
        is_popular,
        is_custom,
        isActive,
        id
      ]
    );
    return result.rows[0];
  }

  /**
   * Delete subscription plan (soft delete by setting is_active to false)
   */
  async delete(id) {
    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Hard delete subscription plan
   */
  async hardDelete(id) {
    const result = await superadminPool.query(
      'DELETE FROM public.subscription_plans WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rowCount > 0;
  }


}

module.exports = new PlansRepository();
