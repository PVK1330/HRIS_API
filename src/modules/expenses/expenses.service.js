'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const notify = require('../notifications/notifications.service');

const STATUSES = new Set([
  'Draft',
  'Pending',
  'Approved',
  'Declined',
  'Rejected',
  'Paid',
  'Reimbursed',
  'Processed',
]);

async function ensureTableColumns(pool) {
  try {
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor VARCHAR(255);');
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS project_client VARCHAR(255);');
    await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255);');
    await pool.query(
      'ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_category_id INTEGER;',
    );
  } catch (err) {
    console.error('Error running migrations/alters for expenses table:', err);
  }
}

async function resolveExpenseCategory(pool, data) {
  const rawId = data.expenseCategoryId ?? data.categoryId;
  const nameFallback = String(data.expenseCategory || data.expense_category || '').trim();

  if (rawId != null && String(rawId).trim() !== '') {
    const idNum = parseInt(String(rawId), 10);
    if (Number.isNaN(idNum)) throw new ApiError(400, 'Invalid expense category id');
    const { rows } = await pool.query(
      `SELECT id, name FROM expense_categories WHERE id = $1 AND is_active = TRUE`,
      [idNum],
    );
    if (!rows[0]) throw new ApiError(400, 'Invalid or inactive expense category');
    return { id: rows[0].id, name: rows[0].name };
  }

  if (nameFallback) {
    const { rows } = await pool.query(
      `SELECT id, name FROM expense_categories
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND is_active = TRUE
       LIMIT 1`,
      [nameFallback],
    );
    if (rows[0]) return { id: rows[0].id, name: rows[0].name };
    return { id: null, name: nameFallback };
  }

  throw new ApiError(400, 'Expense category is required');
}

async function listExpenses(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE 1=1';
  const params = [];

  const employeeIdFilter = (query.employeeId || query.employee_id || '').toString().trim();
  if (employeeIdFilter) {
    whereClause += ` AND ex.employee_id = $${params.length + 1}`;
    params.push(parseInt(employeeIdFilter, 10));
  }

  const categoryIdFilter = (query.expenseCategoryId || query.categoryId || '').toString().trim();
  if (categoryIdFilter && !Number.isNaN(parseInt(categoryIdFilter, 10))) {
    whereClause += ` AND ex.expense_category_id = $${params.length + 1}`;
    params.push(parseInt(categoryIdFilter, 10));
  }

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
      ex.expense_category_id,
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

async function createExpense(tenant, data, receiptFile) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const {
    employeeId,
    employeeName,
    claimTitle,
    expenseDate,
    amount,
    currency,
    paymentMethod,
    vendor,
    description,
    projectClient
  } = data;

  if (!employeeId || !claimTitle || !expenseDate || !amount) {
    throw new ApiError(400, 'Missing required fields');
  }

  let cat;
  cat = await resolveExpenseCategory(pool, data);

  const isDraft = data.isDraft === true || data.isDraft === 'true';
  const numericAmount = parseFloat(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, 'Invalid amount');
  }

  const status = isDraft ? 'Draft' : 'Pending';

  const receiptUrl = receiptFile ? `/uploads/logos/${receiptFile.filename}` : null;

  const query = `
    INSERT INTO expenses (
      employee_id,
      employee_name,
      expense_title,
      expense_category,
      expense_category_id,
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *;
  `;

  const values = [
    parseInt(employeeId, 10),
    employeeName || null,
    claimTitle,
    cat.name,
    cat.id,
    expenseDate,
    numericAmount,
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
  const created = await getExpense(tenant, rows[0].id);

  // Submitted (non-draft) claim → alert admins for approval.
  if (created.status === 'Pending') {
    notify.pushNotification(tenant, {
      forAdmin: true,
      title: `New Expense Claim: ${created.expense_title}`,
      message: `${created.employee_name || 'An employee'} submitted an expense claim of ${created.currency || 'INR'} ${created.amount} for "${created.expense_title}".`,
      type: 'info',
      entityType: 'expense',
      entityId: created.id,
      redirectUrl: '/admin/expenses',
    }).catch(() => null);
  }

  return created;
}

async function updateExpenseClaim(tenant, id, data, user) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);
  const existing = await getExpense(tenant, id);
  const role = user?.role;
  const empId = user?.employeeId;

  const employeeOwned =
    empId != null && parseInt(String(existing.employee_id), 10) === parseInt(String(empId), 10);

  const st = String(existing.status);
  const editableStatus = ['Draft', 'Rejected', 'Declined'].includes(st);

  const canEdit =
    (role === 'admin' && editableStatus) ||
    (role === 'employee' && employeeOwned && editableStatus);

  if (!canEdit) {
    throw new ApiError(403, 'You cannot edit this expense claim');
  }

  const submitNow = data.submitNow === true || data.submitNow === 'true';
  const keepDraft = data.isDraft === true || data.isDraft === 'true';

  let nextStatus = String(existing.status);
  if (submitNow && ['Draft', 'Rejected', 'Declined'].includes(nextStatus)) {
    nextStatus = 'Pending';
  } else if (keepDraft) {
    nextStatus = 'Draft';
  }

  const claimTitle = data.claimTitle ?? data.claim_title ?? existing.expense_title;
  let expenseCategoryName = existing.expense_category;
  let expenseCategoryId = existing.expense_category_id;

  const hasCatUpdate =
    (data.expenseCategoryId != null && String(data.expenseCategoryId).trim() !== '') ||
    (data.categoryId != null && String(data.categoryId).trim() !== '') ||
    (data.expenseCategory != null && String(data.expenseCategory).trim() !== '') ||
    (data.expense_category != null && String(data.expense_category).trim() !== '');

  if (hasCatUpdate) {
    const cat = await resolveExpenseCategory(pool, {
      expenseCategoryId: data.expenseCategoryId ?? data.categoryId,
      expenseCategory: data.expenseCategory ?? data.expense_category,
    });
    expenseCategoryName = cat.name;
    expenseCategoryId = cat.id;
  }

  const expenseDateRaw = data.expenseDate ?? data.expense_date ?? existing.expense_date;
  const expenseDate =
    expenseDateRaw instanceof Date
      ? expenseDateRaw.toISOString().slice(0, 10)
      : String(expenseDateRaw).slice(0, 10);
  const amountVal =
    data.amount != null ? parseFloat(String(data.amount)) : parseFloat(String(existing.amount));
  const currency = data.currency ?? existing.currency;
  const paymentMethod = data.paymentMethod ?? data.payment_method ?? existing.payment_method;
  const description = data.description ?? existing.description;

  if (!claimTitle || !expenseCategoryName || !expenseDate || Number.isNaN(amountVal) || amountVal <= 0) {
    throw new ApiError(400, 'Missing or invalid required fields');
  }

  await pool.query(
    `
    UPDATE expenses SET
      expense_title = $1,
      expense_category = $2,
      expense_category_id = $3,
      expense_date = $4,
      amount = $5,
      currency = $6,
      payment_method = $7,
      description = $8,
      status = $9,
      updated_at = NOW()
    WHERE id = $10
    `,
    [
      claimTitle,
      expenseCategoryName,
      expenseCategoryId,
      expenseDate,
      amountVal,
      currency || 'INR',
      paymentMethod || null,
      description || null,
      nextStatus,
      id,
    ],
  );

  const result = await getExpense(tenant, id);

  // Draft/Rejected claim re-submitted for approval → alert admins.
  if (nextStatus === 'Pending' && String(existing.status) !== 'Pending') {
    notify.pushNotification(tenant, {
      forAdmin: true,
      title: `Expense Claim Submitted: ${result.expense_title}`,
      message: `${result.employee_name || 'An employee'} submitted an expense claim of ${result.currency || 'INR'} ${result.amount} for approval.`,
      type: 'info',
      entityType: 'expense',
      entityId: id,
      redirectUrl: '/admin/expenses',
    }).catch(() => null);
  }

  return result;
}

async function updateExpenseStatus(tenant, id, payload, userId) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  const status = payload.status;
  const rejectionReason = payload.rejectionReason ?? payload.rejection_reason;
  const approver = userId || null;
  const isReject = status === 'Rejected' || status === 'Declined';
  const isApprove = status === 'Approved';
  const isPaid = status === 'Paid' || status === 'Reimbursed' || status === 'Processed';

  let query;
  let values;
  if (isReject) {
    query = `
      UPDATE expenses
      SET
        status = $1,
        rejection_reason = $2,
        approved_by = $3,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;
    values = [status, rejectionReason || null, approver, id];
  } else if (isApprove) {
    query = `
      UPDATE expenses
      SET
        status = $1,
        approved_by = $2,
        approved_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;
    values = [status, approver, id];
  } else if (isPaid) {
    query = `
      UPDATE expenses
      SET
        status = $1,
        reimbursed_at = COALESCE(reimbursed_at, NOW()),
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    values = [status, id];
  } else {
    query = `
      UPDATE expenses
      SET
        status = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    values = [status, id];
  }

  const { rows } = await pool.query(query, values);
  if (!rows.length) throw new ApiError(404, 'Expense claim not found');
  const result = await getExpense(tenant, id);

  // Notify the claim owner of the decision (approval / rejection / payment).
  const empId = result.employee_id ? Number(result.employee_id) : null;
  if (empId) {
    const amountLabel = `${result.currency || 'INR'} ${result.amount}`;
    if (isApprove) {
      notify.sendSystemNotification(tenant, {
        employeeId: empId,
        title: `Expense Approved: ${result.expense_title}`,
        message: `Your expense claim of ${amountLabel} for "${result.expense_title}" has been approved.`,
        type: 'success',
        entityType: 'expense',
        entityId: id,
        redirectUrl: '/employee/expenses',
        sendEmail: true,
      }).catch(() => null);
    } else if (isReject) {
      notify.sendSystemNotification(tenant, {
        employeeId: empId,
        title: `Expense Rejected: ${result.expense_title}`,
        message: `Your expense claim of ${amountLabel} for "${result.expense_title}" was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        type: 'warning',
        entityType: 'expense',
        entityId: id,
        redirectUrl: '/employee/expenses',
        sendEmail: true,
      }).catch(() => null);
    } else if (isPaid) {
      notify.sendSystemNotification(tenant, {
        employeeId: empId,
        title: `Expense Reimbursed: ${result.expense_title}`,
        message: `Your expense claim of ${amountLabel} for "${result.expense_title}" has been marked as ${status}.`,
        type: 'success',
        entityType: 'expense',
        entityId: id,
        redirectUrl: '/employee/expenses',
        sendEmail: true,
      }).catch(() => null);
    }
  }

  return result;
}

async function deleteExpense(tenant, id, user) {
  const pool = await getTenantPool(tenant.dbName);
  await ensureTableColumns(pool);

  if (user?.role === 'employee' && user?.employeeId) {
    const row = await getExpense(tenant, id);
    if (parseInt(String(row.employee_id), 10) !== parseInt(String(user.employeeId), 10)) {
      throw new ApiError(403, 'You cannot delete this expense claim');
    }
    if (String(row.status) !== 'Draft') {
      throw new ApiError(400, 'Only draft claims can be deleted');
    }
  }

  const query = `
    DELETE FROM expenses
    WHERE id = $1
    RETURNING *;
  `;

  const { rows } = await pool.query(query, [id]);
  if (!rows.length) throw new ApiError(404, 'Expense claim not found');
  const deleted = rows[0];

  // An admin removed someone's claim → let the owner know.
  if (deleted?.employee_id && user?.role !== 'employee') {
    notify.sendSystemNotification(tenant, {
      employeeId: Number(deleted.employee_id),
      title: `Expense Claim Removed: ${deleted.expense_title}`,
      message: `Your expense claim "${deleted.expense_title}" (${deleted.currency || 'INR'} ${deleted.amount}) was removed by an administrator.`,
      type: 'warning',
      entityType: 'expense',
      entityId: id,
      redirectUrl: '/employee/expenses',
      sendEmail: false,
    }).catch(() => null);
  }

  return deleted;
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
      COALESCE(COUNT(CASE WHEN status = 'Draft' THEN 1 END), 0)::int as drafts,
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
    drafts: row.drafts,
    pending: row.pending,
    approved: row.approved,
    declined: row.declined,
    paid: row.paid,
    totalClaims: row.total,
    draftClaims: row.drafts,
    pendingClaims: row.pending,
    approvedClaims: row.approved,
    rejectedClaims: row.declined,
  };
}

module.exports = {
  listExpenses,
  getExpense,
  createExpense,
  updateExpenseClaim,
  updateExpenseStatus,
  deleteExpense,
  getExpensesStats,
};
