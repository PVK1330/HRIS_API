// src/modules/superadmin/payments.repository.js
const { superAdminPool } = require('../../config/db');

class PaymentsRepository {
  async findAll({ limit = 10, offset = 0, search = '', status = '' } = {}) {
    let query = `
      SELECT p.*, t.name as tenant_name, sp.plan_name
      FROM public.payments p
      JOIN public.tenants t ON p.tenant_id = t.id
      LEFT JOIN public.tenant_subscriptions ts ON p.subscription_id = ts.id
      LEFT JOIN public.subscription_plans sp ON ts.plan_id = sp.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (t.name ILIKE $${paramIndex} OR p.payment_reference ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status && status !== 'all') {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status.toLowerCase());
      paramIndex++;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await superAdminPool.query(query, params);
    return result.rows;
  }

  async countAll({ search = '', status = '' } = {}) {
    let query = `
      SELECT COUNT(*) as total 
      FROM public.payments p
      JOIN public.tenants t ON p.tenant_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (t.name ILIKE $${paramIndex} OR p.payment_reference ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status && status !== 'all') {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status.toLowerCase());
      paramIndex++;
    }

    const result = await superAdminPool.query(query, params);
    return parseInt(result.rows[0].total, 10);
  }

  async findById(id) {
    const query = `
      SELECT p.*, t.name as tenant_name, sp.plan_name
      FROM public.payments p
      JOIN public.tenants t ON p.tenant_id = t.id
      LEFT JOIN public.tenant_subscriptions ts ON p.subscription_id = ts.id
      LEFT JOIN public.subscription_plans sp ON ts.plan_id = sp.id
      WHERE p.id = $1
    `;
    const result = await superAdminPool.query(query, [id]);
    return result.rows[0];
  }

  async updateStatus(id, status, processedBy) {
    const query = `
      UPDATE public.payments
      SET status = $1, processed_by = $2, processed_at = NOW(), updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    const result = await superAdminPool.query(query, [status, processedBy, id]);
    return result.rows[0];
  }

  async getStats() {
    const query = `
      SELECT 
        SUM(CASE WHEN status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE) THEN amount ELSE 0 END) as monthly_revenue,
        SUM(CASE WHEN status = 'completed' AND created_at >= date_trunc('year', CURRENT_DATE) THEN amount ELSE 0 END) as annual_revenue,
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as outstanding_amount,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM public.payments
    `;
    const result = await superAdminPool.query(query);
    return result.rows[0];
  }
}

module.exports = new PaymentsRepository();
