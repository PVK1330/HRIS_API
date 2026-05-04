// src/modules/superadmin/plans.repository.js
const { superadminPool } = require('../../config/db');

class PlansRepository {
  /**
   * Get all subscription plans
   */
  async findAll(filters = {}) {
    let query = `
      SELECT id, name, code, description, max_users, max_storage_mb,
             price_monthly, price_yearly, features, is_active, created_at, updated_at
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

    query += ' ORDER BY price_monthly ASC';

    const result = await superadminPool.query(query, params);
    return result.rows;
  }

  /**
   * Get plan by ID
   */
  async findById(id) {
    const result = await superadminPool.query(
      `SELECT id, name, code, description, max_users, max_storage_mb,
              price_monthly, price_yearly, features, is_active, created_at, updated_at
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
      `SELECT id, name, code, description, max_users, max_storage_mb,
              price_monthly, price_yearly, features, is_active, created_at, updated_at
       FROM public.subscription_plans
       WHERE code = $1`,
      [code]
    );
    return result.rows[0];
  }

  /**
   * Create new subscription plan
   */
  async create(planData) {
    const {
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive = true
    } = planData;

    const result = await superadminPool.query(
      `INSERT INTO public.subscription_plans (
        name, code, description, max_users, max_storage_mb,
        price_monthly, price_yearly, features, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        name,
        code,
        description || null,
        maxUsers || null,
        maxStorageMb || null,
        priceMonthly || 0,
        priceYearly || 0,
        features || [],
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
      name,
      code,
      description,
      maxUsers,
      maxStorageMb,
      priceMonthly,
      priceYearly,
      features,
      isActive
    } = planData;

    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           description = COALESCE($3, description),
           max_users = COALESCE($4, max_users),
           max_storage_mb = COALESCE($5, max_storage_mb),
           price_monthly = COALESCE($6, price_monthly),
           price_yearly = COALESCE($7, price_yearly),
           features = COALESCE($8, features),
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        name,
        code,
        description,
        maxUsers,
        maxStorageMb,
        priceMonthly,
        priceYearly,
        features,
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

  /**
   * Add feature to plan
   */
  async addFeature(planId, feature) {
    const plan = await this.findById(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    const features = plan.features || [];
    if (!features.includes(feature)) {
      features.push(feature);
    }

    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET features = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [features, planId]
    );
    return result.rows[0];
  }

  /**
   * Remove feature from plan
   */
  async removeFeature(planId, feature) {
    const plan = await this.findById(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    const features = (plan.features || []).filter(f => f !== feature);

    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET features = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [features, planId]
    );
    return result.rows[0];
  }

  /**
   * Update features list
   */
  async updateFeatures(planId, features) {
    const result = await superadminPool.query(
      `UPDATE public.subscription_plans
       SET features = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [features, planId]
    );
    return result.rows[0];
  }
}

module.exports = new PlansRepository();
