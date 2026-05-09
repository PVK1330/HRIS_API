'use strict';

const UPDATABLE_COLUMNS = [
  'name',
  'paid_or_unpaid',
  'annual_entitlement_days',
  'entitlement_label',
  'accrual',
  'max_carry_forward_days',
  'loss_of_pay_rule',
  'document_required',
  'auto_approval',
  'approver',
  'is_active',
  'sort_order',
];

const INSERT_COLUMNS = [...UPDATABLE_COLUMNS, 'is_custom'];

async function getAllLeaveTypes(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM leave_types ORDER BY sort_order ASC NULLS LAST, created_at ASC'
  );
  return rows;
}

async function getLeaveTypeById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM leave_types WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function getLeaveTypeByName(pool, name, excludeId = null) {
  const trimmed = String(name || '').trim();
  const params = [trimmed];
  let sql = `
    SELECT id FROM leave_types
    WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
  `;
  if (excludeId) {
    sql += ' AND id <> $2';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function getNextSortOrder(pool) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM leave_types'
  );
  return rows[0]?.n != null ? parseInt(rows[0].n, 10) : 1;
}

async function createLeaveType(pool, fields) {
  const keys = INSERT_COLUMNS.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) {
    throw new Error('createLeaveType: no fields');
  }
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => fields[k]);
  const sql = `INSERT INTO leave_types (${cols}) VALUES (${placeholders}) RETURNING *`;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function updateLeaveType(pool, id, fields) {
  const keys = UPDATABLE_COLUMNS.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) {
    return getLeaveTypeById(pool, id);
  }

  const fragments = [];
  const values = [];
  let i = 1;
  for (const k of keys) {
    fragments.push(`${k} = $${i}`);
    values.push(fields[k]);
    i += 1;
  }
  fragments.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE leave_types
    SET ${fragments.join(', ')}
    WHERE id = $${i}
    RETURNING *
  `;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function deleteLeaveType(pool, id) {
  const { rows } = await pool.query(
    'DELETE FROM leave_types WHERE id = $1 AND is_custom = true RETURNING id',
    [id]
  );
  return rows[0] || null;
}

async function getRoles(pool) {
  /* Tenant roles table has no is_active column (002_create_roles_table); list all names. */
  const { rows } = await pool.query('SELECT name FROM roles ORDER BY name ASC');
  return rows;
}

module.exports = {
  getAllLeaveTypes,
  getLeaveTypeById,
  getLeaveTypeByName,
  getNextSortOrder,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  getRoles,
};
