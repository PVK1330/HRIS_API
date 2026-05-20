'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listExpenseCategories(tenant, query = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const activeOnly = query.activeOnly !== 'false' && query.activeOnly !== false;
  let where = activeOnly ? 'WHERE is_active = TRUE' : 'WHERE 1=1';
  const params = [];
  const search = (query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    where += ` AND name ILIKE $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT id, name, limit_amount, is_active, sort_order, created_at, updated_at
    FROM expense_categories
    ${where}
    ORDER BY sort_order ASC, name ASC
    `,
    params
  );
  return rows;
}

async function getExpenseCategory(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT id, name, limit_amount, is_active, sort_order, created_at, updated_at
     FROM expense_categories WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Expense category not found');
  return rows[0];
}

async function createExpenseCategory(tenant, body) {
  const pool = await getTenantPool(tenant.dbName);
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(400, 'Name is required');

  const limitAmount =
    body.limitAmount != null && body.limitAmount !== ''
      ? parseFloat(body.limitAmount)
      : null;
  const sortOrder = parseInt(body.sortOrder ?? body.sort_order ?? 0, 10) || 0;

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO expense_categories (name, limit_amount, sort_order)
      VALUES ($1, $2, $3)
      RETURNING id, name, limit_amount, is_active, sort_order, created_at, updated_at
      `,
      [name, Number.isNaN(limitAmount) ? null : limitAmount, sortOrder]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') {
      throw new ApiError(409, 'A category with this name already exists');
    }
    throw e;
  }
}

async function updateExpenseCategory(tenant, id, body) {
  const pool = await getTenantPool(tenant.dbName);
  const existing = await getExpenseCategory(tenant, id);

  const name = body.name != null ? String(body.name).trim() : existing.name;
  if (!name) throw new ApiError(400, 'Name cannot be empty');

  let limitAmount = existing.limit_amount;
  if (body.limitAmount !== undefined || body.limit_amount !== undefined) {
    const raw = body.limitAmount ?? body.limit_amount;
    limitAmount = raw === null || raw === '' ? null : parseFloat(raw);
    if (limitAmount != null && Number.isNaN(limitAmount)) {
      throw new ApiError(400, 'Invalid limit amount');
    }
  }

  const sortOrder =
    body.sortOrder != null || body.sort_order != null
      ? parseInt(body.sortOrder ?? body.sort_order, 10) || 0
      : existing.sort_order;

  const isActive =
    body.is_active !== undefined
      ? Boolean(body.is_active)
      : body.isActive !== undefined
        ? Boolean(body.isActive)
        : existing.is_active;

  try {
    const { rows } = await pool.query(
      `
      UPDATE expense_categories
      SET name = $1,
          limit_amount = $2,
          sort_order = $3,
          is_active = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, limit_amount, is_active, sort_order, created_at, updated_at
      `,
      [name, limitAmount, sortOrder, isActive, id]
    );
    const row = rows[0];

    await pool.query(
      `UPDATE expenses SET expense_category = $1, updated_at = NOW() WHERE expense_category_id = $2`,
      [name, id]
    );

    return row;
  } catch (e) {
    if (e.code === '23505') {
      throw new ApiError(409, 'A category with this name already exists');
    }
    throw e;
  }
}

async function deleteExpenseCategory(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  await getExpenseCategory(tenant, id);
  const { rows } = await pool.query(
    `UPDATE expense_categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!rows.length) throw new ApiError(404, 'Expense category not found');
  return { id };
}

module.exports = {
  listExpenseCategories,
  getExpenseCategory,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
};
