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
    SELECT id, name, description, limit_amount, is_active, sort_order, created_at, updated_at
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
    `SELECT id, name, description, limit_amount, is_active, sort_order, created_at, updated_at
     FROM expense_categories WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Expense category not found');
  return rows[0];
}

async function findCategoryByName(pool, name, { activeOnly } = {}) {
  const params = [name];
  let activeClause = '';
  if (activeOnly === true) activeClause = ' AND is_active = TRUE';
  if (activeOnly === false) activeClause = ' AND is_active = FALSE';

  const { rows } = await pool.query(
    `
    SELECT id, name, description, limit_amount, is_active, sort_order, created_at, updated_at
    FROM expense_categories
    WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
    ${activeClause}
    ORDER BY id ASC
    LIMIT 1
    `,
    params
  );
  return rows[0] || null;
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
  const resolvedLimit = Number.isNaN(limitAmount) ? null : limitAmount;
  const description =
    body.description != null ? String(body.description).trim() : '';

  const existingActive = await findCategoryByName(pool, name, { activeOnly: true });
  if (existingActive) {
    throw new ApiError(409, 'A category with this name already exists');
  }

  // Remove leftover soft-deleted rows so recreate is a brand-new category (new id).
  await pool.query(
    `DELETE FROM expense_categories
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND is_active = FALSE`,
    [name]
  );

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO expense_categories (name, description, limit_amount, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, limit_amount, is_active, sort_order, created_at, updated_at
      `,
      [name, description || null, resolvedLimit, sortOrder]
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

  if (name.toLowerCase() !== String(existing.name || '').trim().toLowerCase()) {
    const dup = await findCategoryByName(pool, name, { activeOnly: true });
    if (dup && dup.id !== Number(id)) {
      throw new ApiError(409, 'A category with this name already exists');
    }
  }

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

  let description = existing.description;
  if (body.description !== undefined) {
    description = body.description == null ? null : String(body.description).trim();
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE expense_categories
      SET name = $1,
          description = $2,
          limit_amount = $3,
          sort_order = $4,
          is_active = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, name, description, limit_amount, is_active, sort_order, created_at, updated_at
      `,
      [name, description || null, limitAmount, sortOrder, isActive, id]
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

  // Permanently remove; existing claims keep expense_category text, FK sets category_id NULL.
  const { rows } = await pool.query(
    `DELETE FROM expense_categories WHERE id = $1 RETURNING id`,
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
