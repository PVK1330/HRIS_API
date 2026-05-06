// src/services/paymentService.js
const { superadminPool } = require('../config/db');

/**
 * Process manual payment for tenant subscription
 */
async function processManualPayment(paymentData, superadminId) {
  const client = await superadminPool.connect();
  
  try {
    await client.query('BEGIN');

    // Validate required fields
    const required = ['tenantId', 'amount', 'paymentMethod', 'billingStartDate', 'billingEndDate'];
    for (const field of required) {
      if (!paymentData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Get tenant info
    const tenantResult = await client.query(
      'SELECT id, subscription_status, plan_id FROM public.tenants WHERE id = $1',
      [paymentData.tenantId]
    );
    if (tenantResult.rows.length === 0) {
      throw new Error('Tenant not found');
    }
    const tenant = tenantResult.rows[0];

    // Get or create subscription
    let subscriptionId = paymentData.subscriptionId;
    if (!subscriptionId) {
      const subResult = await client.query(
        `INSERT INTO public.tenant_subscriptions (
          tenant_id, plan_id, status, billing_cycle,
          current_period_start, current_period_end
        ) VALUES ($1, $2, 'active', $3, $4, $5)
        RETURNING id`,
        [
          tenant.id,
          tenant.plan_id,
          paymentData.billingCycle || 'monthly',
          paymentData.billingStartDate,
          paymentData.billingEndDate
        ]
      );
      subscriptionId = subResult.rows[0].id;
    }

    // Create payment record
    const paymentResult = await client.query(
      `INSERT INTO public.payments (
        tenant_id, subscription_id, amount, currency, payment_method,
        payment_reference, billing_start_date, billing_end_date,
        status, processed_by, processed_at, notes, receipt_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, NOW(), $10, $11)
      RETURNING *`,
      [
        paymentData.tenantId,
        subscriptionId,
        paymentData.amount,
        paymentData.currency || 'AED',
        paymentData.paymentMethod,
        paymentData.paymentReference || null,
        paymentData.billingStartDate,
        paymentData.billingEndDate,
        superadminId,
        paymentData.notes || null,
        paymentData.receiptUrl || null
      ]
    );

    // Update tenant subscription status
    await client.query(
      `UPDATE public.tenants
       SET subscription_status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [paymentData.tenantId]
    );

    // Update subscription record
    await client.query(
      `UPDATE public.tenant_subscriptions
       SET status = 'active', current_period_start = $1, current_period_end = $2, updated_at = NOW()
       WHERE id = $3`,
      [paymentData.billingStartDate, paymentData.billingEndDate, subscriptionId]
    );

    await client.query('COMMIT');

    return paymentResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get payment history for a tenant
 */
async function getTenantPayments(tenantId, filters = {}) {
  let query = `
    SELECT p.*, t.company_name, sp.name as plan_name
    FROM public.payments p
    JOIN public.tenants t ON p.tenant_id = t.id
    LEFT JOIN public.subscription_plans sp ON t.plan_id = sp.id
    WHERE p.tenant_id = $1
  `;
  const params = [tenantId];
  let paramIndex = 2;

  if (filters.status) {
    query += ` AND p.status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.startDate) {
    query += ` AND p.billing_start_date >= $${paramIndex}`;
    params.push(filters.startDate);
    paramIndex++;
  }

  if (filters.endDate) {
    query += ` AND p.billing_end_date <= $${paramIndex}`;
    params.push(filters.endDate);
    paramIndex++;
  }

  query += ' ORDER BY p.created_at DESC';

  const result = await superadminPool.query(query, params);
  return result.rows;
}

/**
 * Get all payments (for superadmin)
 */
async function getAllPayments(filters = {}) {
  let query = `
    SELECT p.*, t.company_name, t.admin_email, sp.name as plan_name
    FROM public.payments p
    JOIN public.tenants t ON p.tenant_id = t.id
    LEFT JOIN public.subscription_plans sp ON t.plan_id = sp.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (filters.tenantId) {
    query += ` AND p.tenant_id = $${paramIndex}`;
    params.push(filters.tenantId);
    paramIndex++;
  }

  if (filters.status) {
    query += ` AND p.status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.startDate) {
    query += ` AND p.created_at >= $${paramIndex}`;
    params.push(filters.startDate);
    paramIndex++;
  }

  if (filters.endDate) {
    query += ` AND p.created_at <= $${paramIndex}`;
    params.push(filters.endDate);
    paramIndex++;
  }

  query += ' ORDER BY p.created_at DESC';

  const result = await superadminPool.query(query, params);
  return result.rows;
}

/**
 * Get payment by ID
 */
async function getPaymentById(paymentId) {
  const result = await superadminPool.query(
    `SELECT p.*, t.company_name, t.admin_email, sp.name as plan_name
     FROM public.payments p
     JOIN public.tenants t ON p.tenant_id = t.id
     LEFT JOIN public.subscription_plans sp ON t.plan_id = sp.id
     WHERE p.id = $1`,
    [paymentId]
  );
  return result.rows[0];
}

/**
 * Refund payment
 */
async function refundPayment(paymentId, refundData, superadminId) {
  const result = await superadminPool.query(
    `UPDATE public.payments
     SET status = 'refunded', notes = COALESCE($2, notes) || ' | Refunded: ' || $3, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [paymentId, refundData.notes, refundData.reason]
  );
  return result.rows[0];
}

/**
 * Get payment statistics
 */
async function getPaymentStats(tenantId = null) {
  let whereClause = tenantId ? 'WHERE p.tenant_id = $1' : 'WHERE 1=1';
  const params = tenantId ? [tenantId] : [];

  const result = await superadminPool.query(
    `SELECT 
      COUNT(*) as total_payments,
      SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_collected,
      SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount,
      SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END) as total_refunded,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
     FROM public.payments p
     ${whereClause}`,
    params
  );
  return result.rows[0];
}

module.exports = {
  processManualPayment,
  getTenantPayments,
  getAllPayments,
  getPaymentById,
  refundPayment,
  getPaymentStats,
};
