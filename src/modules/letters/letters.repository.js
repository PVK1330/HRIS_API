'use strict';

// ─── Templates ────────────────────────────────────────────────────────────────

async function findAllTemplates(pool, { search = '', status = '', category = '', type = '', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(lt.name ILIKE $${params.length} OR lt.category ILIKE $${params.length} OR lt.description ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`lt.status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`lt.category = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`lt.type = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT lt.id, lt.name, lt.type, lt.category, lt.description, lt.body, lt.status, lt.usage_count AS "usageCount",
            TO_CHAR(lt.updated_at, 'DD/MM/YYYY') AS "updatedAt",
            TO_CHAR(lt.created_at, 'DD/MM/YYYY') AS "createdAt"
     FROM letter_templates lt
     ${where}
     ORDER BY lt.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function countTemplates(pool, { search = '', status = '', category = '' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM letter_templates ${where}`,
    params
  );
  return rows[0].total;
}

async function findTemplateById(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, name, type, category, description, body, status, usage_count AS "usageCount",
            TO_CHAR(updated_at, 'DD/MM/YYYY') AS "updatedAt",
            TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"
     FROM letter_templates WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insertTemplate(pool, { name, type, category, description, body, status, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO letter_templates (name, type, category, description, body, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, type, category, description, body, status, usage_count AS "usageCount",
               TO_CHAR(updated_at, 'DD/MM/YYYY') AS "updatedAt",
               TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"`,
    [name, type || 'Letter', category, description || '', body || '', status || 'Active', createdBy || null]
  );
  return rows[0];
}

async function updateTemplate(pool, id, { name, type, category, description, body, status }) {
  const fields = [];
  const params = [];

  if (name !== undefined)        { params.push(name);        fields.push(`name = $${params.length}`); }
  if (type !== undefined)        { params.push(type);        fields.push(`type = $${params.length}`); }
  if (category !== undefined)    { params.push(category);    fields.push(`category = $${params.length}`); }
  if (description !== undefined) { params.push(description); fields.push(`description = $${params.length}`); }
  if (body !== undefined)        { params.push(body);        fields.push(`body = $${params.length}`); }
  if (status !== undefined)      { params.push(status);      fields.push(`status = $${params.length}`); }

  if (!fields.length) return findTemplateById(pool, id);

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE letter_templates SET ${fields.join(', ')}
     WHERE id = $${params.length}
     RETURNING id, name, type, category, description, body, status, usage_count AS "usageCount",
               TO_CHAR(updated_at, 'DD/MM/YYYY') AS "updatedAt",
               TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"`,
    params
  );
  return rows[0] || null;
}

async function incrementUsageCount(pool, id) {
  await pool.query(
    'UPDATE letter_templates SET usage_count = usage_count + 1 WHERE id = $1',
    [id]
  );
}

async function deleteTemplate(pool, id) {
  const { rowCount } = await pool.query(
    'DELETE FROM letter_templates WHERE id = $1',
    [id]
  );
  return rowCount > 0;
}

// ─── Dispatch History ─────────────────────────────────────────────────────────

async function insertDispatch(pool, { templateId, employeeId, employee, template, sentBy, bodySnapshot, status }) {
  const { rows } = await pool.query(
    `INSERT INTO letter_dispatch_history
       (template_id, employee_id, employee, template, sent_by, body_snapshot, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, employee, template, sent_by AS "sentBy",
               TO_CHAR(sent_at, 'DD/MM/YYYY') AS "sentAt", status`,
    [templateId, employeeId || null, employee, template, sentBy, bodySnapshot || null, status || 'Delivered']
  );
  return rows[0];
}

async function findAllHistory(pool, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, employee, template, sent_by AS "sentBy",
            TO_CHAR(sent_at, 'DD/MM/YYYY') AS "sentAt", status
     FROM letter_dispatch_history
     ORDER BY sent_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function countHistory(pool) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM letter_dispatch_history'
  );
  return rows[0].total;
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function getKpis(pool) {
  const [tplRes, histRes, pendRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM letter_templates WHERE status = 'Active'`),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM letter_dispatch_history
       WHERE sent_at >= date_trunc('month', NOW())`
    ),
    // "Pending signatures" — dispatched this month that are not yet Delivered
    pool.query(
      `SELECT COUNT(*)::int AS total FROM letter_dispatch_history
       WHERE status <> 'Delivered'`
    ),
  ]);
  return {
    templates: tplRes.rows[0].total,
    generatedThisMonth: histRes.rows[0].total,
    pendingSignatures: pendRes.rows[0].total,
  };
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

async function findAllTags(pool) {
  const { rows } = await pool.query(
    `SELECT id, tag, description, is_system AS "isSystem",
            TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"
     FROM letter_tags
     ORDER BY is_system DESC, id ASC`
  );
  return rows;
}

async function findTagById(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, tag, description, is_system AS "isSystem"
     FROM letter_tags WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insertTag(pool, { tag, description, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO letter_tags (tag, description, is_system, created_by)
     VALUES ($1, $2, FALSE, $3)
     RETURNING id, tag, description, is_system AS "isSystem",
               TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"`,
    [tag, description || '', createdBy || null]
  );
  return rows[0];
}

async function updateTag(pool, id, { tag, description }) {
  const fields = [];
  const params = [];
  if (tag !== undefined)         { params.push(tag);         fields.push(`tag = $${params.length}`); }
  if (description !== undefined) { params.push(description); fields.push(`description = $${params.length}`); }
  if (!fields.length) return findTagById(pool, id);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE letter_tags SET ${fields.join(', ')}
     WHERE id = $${params.length} AND is_system = FALSE
     RETURNING id, tag, description, is_system AS "isSystem",
               TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"`,
    params
  );
  return rows[0] || null;
}

async function deleteTag(pool, id) {
  const { rowCount } = await pool.query(
    'DELETE FROM letter_tags WHERE id = $1 AND is_system = FALSE',
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  findAllTemplates,
  countTemplates,
  findTemplateById,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  incrementUsageCount,
  insertDispatch,
  findAllHistory,
  countHistory,
  getKpis,
  // tags
  findAllTags,
  findTagById,
  insertTag,
  updateTag,
  deleteTag,
};
