'use strict';

const {
  buildAudienceWhere,
  parseAudienceConfig,
  employeeMatchesAudience,
} = require('./policies.audience');
const { mapPolicyRow } = require('./policies.normalize');

async function findAll(pool, filters = {}) {
  const { category, status } = filters;
  const conditions = [];
  const params = [];

  if (category && category !== 'All Categories') {
    params.push(category);
    conditions.push(`p.category = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `
    SELECT 
      p.*,
      (SELECT COUNT(*) FROM policy_acknowledgements WHERE policy_id = p.id) as ack_count
    FROM policies p
    ${whereClause}
    ORDER BY p.updated_at DESC
  `,
    params,
  );

  return rows.map(mapPolicyRow);
}

async function findById(pool, id) {
  const { rows } = await pool.query(
    `
    SELECT p.*, e.full_name as created_by_name
    FROM policies p
    LEFT JOIN employees e ON e.id = p.created_by
    WHERE p.id = $1
  `,
    [id],
  );
  return mapPolicyRow(rows[0]);
}

async function create(pool, data) {
  const {
    title,
    category,
    version,
    description,
    effectiveDate,
    reviewDate,
    ackRequired,
    audience,
    audienceConfig,
    status,
    content,
    sections,
    fileUrl,
    attachments,
    createdBy,
  } = data;

  const contentPayload = JSON.stringify({
    sections: sections || {},
  });

  const audienceCfg = audienceConfig || { type: 'all' };

  const { rows } = await pool.query(
    `
    INSERT INTO policies (
      title, category, version, description, effective_date,
      review_date, ack_required, audience, audience_config, status,
      content, file_url, attachments, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `,
    [
      title,
      category,
      version || '1.0',
      description,
      effectiveDate || null,
      reviewDate || null,
      ackRequired !== false,
      audience || 'All Employees',
      JSON.stringify(audienceCfg),
      status || 'Draft',
      contentPayload,
      fileUrl || null,
      JSON.stringify(attachments || []),
      createdBy || null,
    ],
  );

  return mapPolicyRow(rows[0]);
}

async function update(pool, id, data) {
  const fields = [];
  const params = [id];
  let i = 2;

  const scalarMap = {
    title: 'title',
    category: 'category',
    version: 'version',
    description: 'description',
    effectiveDate: 'effective_date',
    reviewDate: 'review_date',
    ackRequired: 'ack_required',
    audience: 'audience',
    status: 'status',
    fileUrl: 'file_url',
  };

  for (const [key, col] of Object.entries(scalarMap)) {
    if (data[key] !== undefined) {
      fields.push(`${col} = $${i++}`);
      params.push(data[key]);
    }
  }

  if (data.audienceConfig !== undefined) {
    fields.push(`audience_config = $${i++}`);
    params.push(JSON.stringify(data.audienceConfig));
  }

  if (data.sections !== undefined) {
    fields.push(`content = $${i++}`);
    params.push(JSON.stringify({ sections: data.sections }));
  }

  if (data.attachments !== undefined) {
    fields.push(`attachments = $${i++}`);
    params.push(JSON.stringify(data.attachments));
  }

  if (fields.length === 0) return findById(pool, id);

  fields.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `
    UPDATE policies
    SET ${fields.join(', ')}
    WHERE id = $1
    RETURNING *
  `,
    params,
  );

  return mapPolicyRow(rows[0]);
}

async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM policies WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getAcknowledgements(pool, policyId) {
  const policy = await findById(pool, policyId);
  if (!policy) return [];

  const config = parseAudienceConfig(policy.audience_config);
  const { clause, params: audienceParams } = buildAudienceWhere(config, 2);
  const ackIdx = 2 + audienceParams.length;
  const queryParams = [policyId, ...audienceParams, policy.ack_required !== false];

  const { rows } = await pool.query(
    `
    SELECT 
      e.id as employee_id,
      e.full_name,
      e.emp_id,
      e.job_title,
      COALESCE(d.name, e.department, '—') as department,
      pa.acknowledged_at,
      CASE
        WHEN NOT (${clause}) THEN 'Not Applicable'
        WHEN pa.id IS NOT NULL THEN 'Acknowledged'
        WHEN $${ackIdx}::boolean = FALSE THEN 'Not Applicable'
        ELSE 'Pending'
      END as status
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN policy_acknowledgements pa
      ON pa.employee_id = e.id AND pa.policy_id = $1
    WHERE e.deleted_at IS NULL
    ORDER BY
      CASE
        WHEN NOT (${clause}) THEN 3
        WHEN pa.id IS NOT NULL THEN 1
        ELSE 2
      END,
      e.full_name ASC
  `,
    queryParams,
  );

  return rows;
}

async function findEmployeeById(pool, employeeId) {
  const { rows } = await pool.query(
    `
    SELECT id, department_id, rbac_role_id, join_date, full_name, emp_id, deleted_at
    FROM employees
    WHERE id = $1 AND deleted_at IS NULL
  `,
    [employeeId],
  );
  return rows[0] || null;
}

function mapEmployeePolicyRow(row, employee) {
  const policy = mapPolicyRow(row);
  const inAudience = employeeMatchesAudience(employee, row.audience_config);
  let ackStatus = 'Not Applicable';
  if (!inAudience) {
    ackStatus = 'Not Applicable';
  } else if (row.acknowledged_at) {
    ackStatus = 'Acknowledged';
  } else if (row.ack_required === false) {
    ackStatus = 'Not Applicable';
  } else {
    ackStatus = 'Pending';
  }
  return {
    ...policy,
    ackStatus,
    acknowledgedAt: row.acknowledged_at || null,
    applicable: inAudience,
  };
}

async function findPublishedForEmployee(pool, employeeId) {
  const employee = await findEmployeeById(pool, employeeId);
  if (!employee) return { employee: null, policies: [] };

  const { rows } = await pool.query(
    `
    SELECT p.*, pa.acknowledged_at
    FROM policies p
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = p.id AND pa.employee_id = $1
    WHERE p.status = 'Published'
    ORDER BY p.updated_at DESC
  `,
    [employeeId],
  );

  const policies = rows
    .map((r) => mapEmployeePolicyRow(r, employee))
    .filter((p) => p.applicable);

  return { employee, policies };
}

async function findPublishedByIdForEmployee(pool, policyId, employeeId) {
  const employee = await findEmployeeById(pool, employeeId);
  if (!employee) return null;

  const { rows } = await pool.query(
    `
    SELECT p.*, pa.acknowledged_at
    FROM policies p
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = p.id AND pa.employee_id = $2
    WHERE p.id = $1 AND p.status = 'Published'
  `,
    [policyId, employeeId],
  );

  if (!rows[0]) return null;
  const mapped = mapEmployeePolicyRow(rows[0], employee);
  if (!mapped.applicable) return null;
  return mapped;
}

async function acknowledge(pool, policyId, employeeId) {
  const { rows } = await pool.query(
    `
    INSERT INTO policy_acknowledgements (policy_id, employee_id)
    VALUES ($1, $2)
    ON CONFLICT (policy_id, employee_id) DO UPDATE SET acknowledged_at = CURRENT_TIMESTAMP
    RETURNING *
  `,
    [policyId, employeeId],
  );
  return rows[0];
}

async function listCategories(pool) {
  const { rows } = await pool.query(`
    SELECT * FROM policy_categories 
    ORDER BY name ASC
  `);
  return rows;
}

async function listCategoriesWithStats(pool) {
  const { rows } = await pool.query(`
    SELECT 
      pc.id,
      pc.name,
      pc.description,
      pc.icon_name,
      pc.created_at,
      pc.updated_at,
      COUNT(p.id)::int AS policy_count,
      MAX(p.updated_at) AS last_policy_update
    FROM policy_categories pc
    LEFT JOIN policies p ON p.category = pc.name
    GROUP BY pc.id, pc.name, pc.description, pc.icon_name, pc.created_at, pc.updated_at
    ORDER BY pc.name ASC
  `);
  return rows.map((r) => ({
    ...r,
    policyCount: parseInt(r.policy_count, 10) || 0,
    lastUpdated: r.last_policy_update || r.updated_at,
  }));
}

async function createCategory(pool, data) {
  const { name, description, iconName } = data;
  const { rows } = await pool.query(
    `
    INSERT INTO policy_categories (name, description, icon_name)
    VALUES ($1, $2, $3)
    RETURNING *
  `,
    [name, description, iconName || 'HiDocumentText'],
  );
  return rows[0];
}

async function updateCategory(pool, id, data) {
  const { name, description, iconName } = data;
  const { rows } = await pool.query(
    `
    UPDATE policy_categories 
    SET name = $1, description = $2, icon_name = $3, updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `,
    [name, description, iconName, id],
  );
  return rows[0];
}

async function deleteCategory(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM policy_categories WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  findEmployeeById,
  findPublishedForEmployee,
  findPublishedByIdForEmployee,
  create,
  update,
  remove,
  getAcknowledgements,
  acknowledge,
  listCategories,
  listCategoriesWithStats,
  createCategory,
  updateCategory,
  deleteCategory,
};
