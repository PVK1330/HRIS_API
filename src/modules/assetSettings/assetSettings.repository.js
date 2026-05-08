'use strict';

const CATEGORY_UPDATE_KEYS = new Set([
  'name',
  'icon',
  'color',
  'sort_order',
  'is_active',
]);

async function getAllCategories(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM asset_categories ORDER BY sort_order ASC, created_at ASC`
  );
  return rows;
}

async function getCategoryById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM asset_categories WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function findCategoryByNameLower(pool, name) {
  const { rows } = await pool.query(
    `SELECT id FROM asset_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

async function findCategoryByNameLowerExcludingId(pool, name, excludeId) {
  const { rows } = await pool.query(
    `SELECT id FROM asset_categories WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,
    [name, excludeId]
  );
  return rows[0] || null;
}

async function createCategory(pool, { name, icon, color, sortOrder }) {
  const { rows } = await pool.query(
    `
      INSERT INTO asset_categories (name, icon, color, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [name, icon, color, sortOrder]
  );
  return rows[0] || null;
}

async function updateCategory(pool, id, fields) {
  const keys = Object.keys(fields).filter(
    (k) => CATEGORY_UPDATE_KEYS.has(k) && fields[k] !== undefined
  );

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
    UPDATE asset_categories
    SET ${fragments.join(', ')}
    WHERE id = $${i}
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function deleteCategory(pool, id) {
  const { rows } = await pool.query(
    `DELETE FROM asset_categories WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows[0] || null;
}

async function getRules(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM asset_rules ORDER BY created_at ASC LIMIT 1`
  );
  return rows[0] || null;
}

async function seedDefaultRules(pool) {
  await pool.query(`
    INSERT INTO asset_rules (id)
    SELECT gen_random_uuid()
    WHERE NOT EXISTS (SELECT 1 FROM asset_rules LIMIT 1)
  `);
  return getRules(pool);
}

const RULE_UPDATE_KEYS = new Set([
  'assigning_rule',
  'return_rule',
  'lost_damaged_policy',
  'approval_workflow',
]);

async function updateRules(pool, fields) {
  const keys = Object.keys(fields).filter(
    (k) => RULE_UPDATE_KEYS.has(k) && fields[k] !== undefined
  );

  const fragments = [];
  const values = [];
  let i = 1;

  for (const k of keys) {
    fragments.push(`${k} = $${i}`);
    values.push(fields[k]);
    i += 1;
  }

  fragments.push('updated_at = NOW()');

  const sql = `
    UPDATE asset_rules
    SET ${fragments.join(', ')}
    WHERE id = (SELECT id FROM asset_rules ORDER BY created_at ASC LIMIT 1)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

module.exports = {
  getAllCategories,
  getCategoryById,
  findCategoryByNameLower,
  findCategoryByNameLowerExcludingId,
  createCategory,
  updateCategory,
  deleteCategory,
  getRules,
  seedDefaultRules,
  updateRules,
};
