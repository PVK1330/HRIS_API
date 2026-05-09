'use strict';

const ALL_COLUMNS = [
  'name',
  'is_required',
  'mandatory_or_optional',
  'who_must_upload',
  'expiry_tracking',
  'reminder_before_expiry_days',
  'hr_approval_required',
  'visibility',
  'sort_order',
  'is_active',
];

async function getAllDocumentTypes(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM document_types ORDER BY sort_order ASC NULLS LAST, created_at ASC'
  );
  return rows;
}

async function getDocumentTypeById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM document_types WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function findByNameCaseInsensitive(pool, name, excludeId) {
  const params = [String(name).trim()];
  let sql = `
    SELECT * FROM document_types
    WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
  `;
  if (excludeId) {
    sql += ' AND id <> $2 LIMIT 1';
    params.push(excludeId);
  } else {
    sql += ' LIMIT 1';
  }
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function getNextSortOrder(pool) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM document_types'
  );
  return rows[0]?.n != null ? parseInt(rows[0].n, 10) : 1;
}

async function createDocumentType(pool, fields) {
  const keys = ALL_COLUMNS.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) {
    throw new Error('createDocumentType: no fields');
  }
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => fields[k]);
  const sql = `INSERT INTO document_types (${cols}) VALUES (${placeholders}) RETURNING *`;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function updateDocumentType(pool, id, fields) {
  const keys = ALL_COLUMNS.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) {
    return getDocumentTypeById(pool, id);
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
    UPDATE document_types
    SET ${fragments.join(', ')}
    WHERE id = $${i}
    RETURNING *
  `;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function deleteDocumentType(pool, id) {
  const { rows } = await pool.query(
    'DELETE FROM document_types WHERE id = $1 RETURNING id',
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  getAllDocumentTypes,
  getDocumentTypeById,
  findByNameCaseInsensitive,
  getNextSortOrder,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
};
