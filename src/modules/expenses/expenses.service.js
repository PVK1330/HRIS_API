'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const STATUSES = new Set(['Pending', 'Approved', 'Declined', 'Rejected', 'Paid', 'Reimbursed']);

async function ensureTableColumns(pool) {
  try {
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor VARCHAR(255);');
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS project_client VARCHAR(255);');
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255);');
  } catch (err) {
    console.error('Error running migrations/alters for expenses table:', err);
  }
}

async function listExpenses(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE 1=1';
  const params = [];

  // Search by employee name using regex matching (~* is case-insensitive POSIX regex in Postgres)
  const search = (query.search || '').trim();
  if (search) {
    whereClause += ` AND (COALESCE(ex.employee_name, emp.full_name) ~* $${params.length + 1})`;
    params.push(search);
  }

  // Filter by category or status (dual-use expenseType query param)
  const expenseType = (query.expenseType || '').trim();
  if (expenseType && expenseType !== 'All') {
    if (STATUSES.has(expenseType)) {
      if (expenseType === 'Declined' || expenseType === 'Rejected') {
        whereClause += ` AND ex.status IN ($${params.length + 1}, $${params.length + 2})`;
        params.push('Declined', 'Rejected');
      } else if (expenseType === 'Paid' || expenseType === 'Reimbursed') {
        whereClause += ` AND ex.status IN ($${params.length + 1}, $${params.length + 2})`;
        params.push('Paid', 'Reimbursed');
      } else {
        whereClause += ` AND ex.status = $${params.length + 1}`;
        params.push(expenseType);
      }
    } else {
      whereClause += ` AND ex.expense_category = $${params.length + 1}`;
      params.push(expenseType);
    }
  }

  // Get total count
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, params);
  const total = countResult.rows[0]?.total ?? 0;

  // Get records
  const dataQuery = `
    SELECT 
      ex.id,
      ex.employee_id,
      COALESCE(ex.employee_name, emp.full_name) AS employee_name,
      COALESCE(emp.department, 'Operations') AS department,
      ex.expense_category,
      ex.expense_title AS claim_title,
      ex.amount,
      ex.currency,
      TO_CHAR(ex.expense_date, 'YYYY-MM-DD') AS expense_date,
      ex.payment_method,
      ex.project_department,
      ex.project_client,
      ex.description,
      ex.receipt_url,
      ex.status,
      ex.created_at,
      ex.vendor
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    ${whereClause}
    ORDER BY ex.created_at DESC, ex.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(dataQuery, dataParams);

  return {
    data: rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

async function getExpense(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const query = `
    SELECT 
      ex.*,
      ex.expense_title AS claim_title,
      COALESCE(ex.employee_name, emp.full_name) AS employee_name,
      COALESCE(emp.department, 'Operations') AS department
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    WHERE ex.id = $1
  `;

  const { rows } = await pool.query(query, [id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'Expense claim not found');
  return row;
}

function calculateAutomaticStatus(amount, receiptFile) {
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return 'Rejected';
  }
  // Auto-approve claims below 100 AED/USD if a receipt is uploaded
  if (numericAmount < 100 && receiptFile) {
    return 'Approved';
  }
  return 'Pending';
}

async function createExpense(tenant, data, receiptFile) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const {
    employeeId,
    employeeName,
    claimTitle,
    expenseCategory,
    expenseDate,
    amount,
    currency,
    paymentMethod,
    vendor,
    description,
    projectClient
  } = data;

  if (!employeeId || !claimTitle || !expenseCategory || !expenseDate || !amount) {
    throw new ApiError(400, 'Missing required fields');
  }

  // Automatic status calculation before saving/updating
  const status = calculateAutomaticStatus(amount, receiptFile);

  const receiptUrl = receiptFile ? `/uploads/logos/${receiptFile.filename}` : null;

  const query = `
    INSERT INTO expenses (
      employee_id,
      employee_name,
      expense_title,
      expense_category,
      expense_date,
      amount,
      currency,
      payment_method,
      vendor,
      description,
      project_client,
      project_department,
      receipt_url,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *;
  `;

  const values = [
    parseInt(employeeId, 10),
    employeeName || null,
    claimTitle,
    expenseCategory,
    expenseDate,
    parseFloat(amount),
    currency || 'INR',
    paymentMethod || null,
    vendor || null,
    description || null,
    projectClient || null,
    projectClient || null,
    receiptUrl,
    status
  ];

  const { rows } = await pool.query(query, values);
  return getExpense(tenant, rows[0].id);
}

async function updateExpenseStatus(tenant, id, status, userId) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const query = `
    UPDATE expenses
    SET 
      status = $1,
      approved_by = $2,
      approved_at = NOW(),
      updated_at = NOW()
    WHERE id = $3
    RETURNING *;
  `;

  const { rows } = await pool.query(query, [status, userId || null, id]);
  if (!rows.length) throw new ApiError(404, 'Expense claim not found');
  return getExpense(tenant, id);
}

async function deleteExpense(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const query = `
    DELETE FROM expenses
    WHERE id = $1
    RETURNING *;
  `;

  const { rows } = await pool.query(query, [id]);
  if (!rows.length) throw new ApiError(404, 'Expense claim not found');
  return rows[0];
}

async function getExpensesStats(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  let whereClause = 'WHERE 1=1';
  const params = [];

  const employeeId = query.employeeId || query.employee_id;
  if (employeeId) {
    whereClause += ` AND employee_id = $${params.length + 1}`;
    params.push(parseInt(employeeId, 10));
  }

  const statsQuery = `
    SELECT
      COALESCE(COUNT(*), 0)::int as total,
      COALESCE(COUNT(CASE WHEN status = 'Pending' THEN 1 END), 0)::int as pending,
      COALESCE(COUNT(CASE WHEN status = 'Approved' THEN 1 END), 0)::int as approved,
      COALESCE(COUNT(CASE WHEN status = 'Declined' OR status = 'Rejected' THEN 1 END), 0)::int as declined,
      COALESCE(COUNT(CASE WHEN status = 'Paid' OR status = 'Reimbursed' THEN 1 END), 0)::int as paid
    FROM expenses
    ${whereClause}
  `;

  const { rows } = await pool.query(statsQuery, params);
  const row = rows[0];
  
  return {
    total: row.total,
    pending: row.pending,
    approved: row.approved,
    declined: row.declined,
    paid: row.paid,
    totalClaims: row.total,
    pendingClaims: row.pending,
    approvedClaims: row.approved,
    rejectedClaims: row.declined
  };
}

module.exports = {
  listExpenses,
  getExpense,
  createExpense,
  updateExpenseStatus,
  deleteExpense,
  getExpensesStats
};
