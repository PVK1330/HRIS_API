'use strict';

const crypto = require('crypto');
const {
  buildAudienceWhere,
  parseAudienceConfig,
  employeeMatchesAudience,
} = require('./policies.audience');
const { mapPolicyRow, parseSections, parseAttachments, EMPTY_SECTIONS } = require('./policies.normalize');

/**
 * Deterministic JSON: recursively sorts object keys so key ORDER can never change
 * the serialization (and therefore the hash). Arrays keep their order.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Canonical, normalized representation of the policy BODY. The EXACT fields fed
 * into the content hash are:
 *   - sections:    merged with EMPTY_SECTIONS so the shape is ALWAYS the same 9
 *                  keys (introduction, purpose, scope, definitions,
 *                  rulesAndProcedures, examples, faqs, exceptions, contactPerson),
 *                  each value coerced to a string; keys sorted by stableStringify.
 *   - attachments: the set of attachment URLs only — de-duplicated and sorted.
 *                  Display names (originalName) are excluded so a rename is NOT a
 *                  material change; only swapping the actual file (url) is.
 *   - fileUrl:     the single uploaded-file URL, or null.
 * Metadata (title, category, description, dates, audience, version label, status)
 * is intentionally excluded — editing it must not force re-acknowledgement.
 *
 * This normalization is applied IDENTICALLY at create and update time, so a no-op
 * re-save (same body, possibly different key/attachment order or partial sections)
 * always yields the same hash and never bumps the version.
 */
function canonicalContent({ sections, attachments, fileUrl }) {
  const merged = { ...EMPTY_SECTIONS, ...(sections || {}) };
  const normSections = {};
  for (const k of Object.keys(merged)) {
    normSections[k] = merged[k] == null ? '' : String(merged[k]);
  }
  const urls = parseAttachments(attachments)
    .map((a) => (typeof a === 'string' ? a : (a && (a.url || a.fileUrl)) || ''))
    .filter(Boolean);
  return {
    sections: normSections,
    attachments: Array.from(new Set(urls)).sort(),
    fileUrl: fileUrl ? String(fileUrl) : null,
  };
}

function computeContentHash(body) {
  return crypto.createHash('sha256').update(stableStringify(canonicalContent(body))).digest('hex');
}

async function findAll(pool, filters = {}) {
  const { category, status } = filters;
  // Archived (soft-deleted) policies are hidden from every normal listing.
  const conditions = ['p.archived_at IS NULL'];
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

/** Archived (soft-deleted) policies, most-recently-archived first. Admin read-only. */
async function findAllArchived(pool) {
  const { rows } = await pool.query(
    `
    SELECT p.*,
      (SELECT COUNT(*) FROM policy_acknowledgements WHERE policy_id = p.id) as ack_count
    FROM policies p
    WHERE p.archived_at IS NOT NULL
    ORDER BY p.archived_at DESC
  `,
  );
  return rows.map(mapPolicyRow);
}

async function findById(pool, id, { includeArchived = false } = {}) {
  // Archived policies are hidden by default (admin get / tracking → 404). Internal
  // callers that genuinely need an archived row can opt in via includeArchived.
  const archivedClause = includeArchived ? '' : 'AND p.archived_at IS NULL';
  const { rows } = await pool.query(
    `
    SELECT p.*, e.full_name as created_by_name
    FROM policies p
    LEFT JOIN employees e ON e.id = p.created_by
    WHERE p.id = $1 ${archivedClause}
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
  const contentHash = computeContentHash({ sections: sections || {}, attachments, fileUrl });
  const isPublished = (status || 'Draft') === 'Published';

  const { rows } = await pool.query(
    `
    INSERT INTO policies (
      title, category, version, description, effective_date,
      review_date, ack_required, audience, audience_config, status,
      content, file_url, attachments, created_by, content_hash, published_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      contentHash,
      isPublished ? new Date() : null,
    ],
  );

  return mapPolicyRow(rows[0]);
}

/**
 * Updates a policy and, atomically, maintains its content version.
 *
 * Returns { policy, transitionedToPublished, versionBumped } so the service can
 * decide whether to (re)notify the audience:
 *   - transitionedToPublished: Draft/other -> Published (first time this content goes live)
 *   - versionBumped: a PUBLISHED policy's body materially changed, OR the caller
 *     passed requireReacknowledgement=true. The version bump makes every prior
 *     acknowledgement count as Pending again (re-acknowledgement required).
 *
 * Wrapped in a transaction with SELECT ... FOR UPDATE so two concurrent publishes
 * can't double-bump or race the version.
 */
async function update(pool, id, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: prevRows } = await client.query(
      'SELECT * FROM policies WHERE id = $1 AND archived_at IS NULL FOR UPDATE',
      [id],
    );
    const prev = prevRows[0];
    if (!prev) {
      await client.query('ROLLBACK');
      return { policy: null, transitionedToPublished: false, versionBumped: false };
    }

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

    // Changing the review_date starts a fresh review cycle → re-arm review reminders.
    if (data.reviewDate !== undefined) {
      fields.push('review_reminded_at = NULL');
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

    // Effective body AFTER this update (incoming value wins, else keep existing).
    const effSections = data.sections !== undefined ? data.sections : parseSections(prev.content);
    const effAttachments = data.attachments !== undefined ? data.attachments : parseAttachments(prev.attachments);
    const effFileUrl = data.fileUrl !== undefined ? data.fileUrl : prev.file_url;
    const newHash = computeContentHash({ sections: effSections, attachments: effAttachments, fileUrl: effFileUrl });

    const wasPublished = String(prev.status) === 'Published';
    const newStatus = data.status !== undefined ? data.status : prev.status;
    const willBePublished = String(newStatus) === 'Published';

    const transitionedToPublished = willBePublished && !wasPublished;
    // First-deploy safety: rows created before content_hash existed have a NULL
    // baseline. The first edit must only ESTABLISH the baseline, never count as a
    // material change (which would force an org-wide re-acknowledgement). We still
    // write the freshly-computed hash below, so subsequent edits compare correctly.
    const hasBaseline = prev.content_hash != null && String(prev.content_hash) !== '';
    const materialChange = hasBaseline && newHash !== prev.content_hash;
    const requireReack = data.requireReacknowledgement === true;
    // Only a policy that is (and stays) published can require RE-acknowledgement.
    const versionBumped = willBePublished && wasPublished && (requireReack || materialChange);

    fields.push(`content_hash = $${i++}`);
    params.push(newHash);

    if (versionBumped) {
      fields.push('content_version = content_version + 1');
    }
    if (transitionedToPublished || versionBumped) {
      // (Re)publishing this version resets the "since when" baseline for reminders.
      fields.push('published_at = NOW()');
    }

    fields.push('updated_at = NOW()');

    const { rows } = await client.query(
      `UPDATE policies SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );

    await client.query('COMMIT');
    return {
      policy: mapPolicyRow(rows[0]),
      transitionedToPublished,
      versionBumped,
    };
  } catch (err) {
    // Guard the rollback so a failed ROLLBACK (e.g. dead connection) can't mask
    // the original error; the client is still released by finally either way.
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Soft delete: archive the policy (keep the row + its acknowledgement history).
 * Returns the archived row { id, content_version } or null if it was missing or
 * already archived. NEVER hard-deletes — compliance history must survive.
 */
async function remove(pool, id) {
  const { rows } = await pool.query(
    `UPDATE policies
        SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND archived_at IS NULL
      RETURNING id, content_version`,
    [id],
  );
  return rows[0] || null;
}

async function getAcknowledgements(pool, policyId) {
  // includeArchived: tracking/compliance history must remain viewable AFTER a
  // policy is archived (the whole point of soft delete — reachable history).
  const policy = await findById(pool, policyId, { includeArchived: true });
  if (!policy) return [];

  const config = parseAudienceConfig(policy.audience_config);
  const { clause, params: audienceParams } = buildAudienceWhere(config, 2);
  const ackIdx = 2 + audienceParams.length;       // ack_required boolean
  const verIdx = ackIdx + 1;                       // current content version
  const currentVersion = Number(policy.content_version || policy.contentVersion || 1);
  const queryParams = [policyId, ...audienceParams, policy.ack_required !== false, currentVersion];

  const { rows } = await pool.query(
    `
    SELECT
      e.id as employee_id,
      e.full_name,
      e.emp_id,
      e.job_title,
      COALESCE(d.name, e.department, '—') as department,
      pa.acknowledged_at,
      pa.acknowledged_version,
      CASE
        WHEN NOT (${clause}) THEN 'Not Applicable'
        WHEN $${ackIdx}::boolean = FALSE THEN 'Not Applicable'
        WHEN pa.id IS NOT NULL AND pa.acknowledged_version = $${verIdx}::int THEN 'Acknowledged'
        WHEN pa.id IS NOT NULL THEN 'Pending'
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
        WHEN pa.id IS NOT NULL AND pa.acknowledged_version = $${verIdx}::int THEN 1
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
  const currentVersion = Number(row.content_version || 1);
  const ackedVersion = row.acknowledged_version != null ? Number(row.acknowledged_version) : null;
  // An acknowledgement only counts if it was made against the CURRENT version.
  const ackedCurrent = ackedVersion != null && ackedVersion >= currentVersion;
  const needsReack = ackedVersion != null && ackedVersion < currentVersion;

  let ackStatus = 'Not Applicable';
  if (!inAudience) {
    ackStatus = 'Not Applicable';
  } else if (row.ack_required === false) {
    ackStatus = 'Not Applicable';
  } else if (ackedCurrent) {
    ackStatus = 'Acknowledged';
  } else {
    ackStatus = 'Pending';
  }
  return {
    ...policy,
    ackStatus,
    acknowledgedAt: ackedCurrent ? (row.acknowledged_at || null) : null,
    acknowledgedVersion: ackedVersion,
    currentVersion,
    // True when the employee acknowledged an OLDER version and must re-acknowledge.
    needsReacknowledgement: inAudience && row.ack_required !== false && needsReack,
    applicable: inAudience,
  };
}

async function findPublishedForEmployee(pool, employeeId) {
  const employee = await findEmployeeById(pool, employeeId);
  if (!employee) return { employee: null, policies: [] };

  const { rows } = await pool.query(
    `
    SELECT p.*, pa.acknowledged_at, pa.acknowledged_version
    FROM policies p
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = p.id AND pa.employee_id = $1
    WHERE p.status = 'Published' AND p.archived_at IS NULL
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
    SELECT p.*, pa.acknowledged_at, pa.acknowledged_version
    FROM policies p
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = p.id AND pa.employee_id = $2
    WHERE p.id = $1 AND p.status = 'Published' AND p.archived_at IS NULL
  `,
    [policyId, employeeId],
  );

  if (!rows[0]) return null;
  const mapped = mapEmployeePolicyRow(rows[0], employee);
  if (!mapped.applicable) return null;
  return mapped;
}

async function acknowledge(pool, policyId, employeeId, version = 1) {
  const { rows } = await pool.query(
    `
    INSERT INTO policy_acknowledgements (policy_id, employee_id, acknowledged_version, status, acknowledged_at)
    VALUES ($1, $2, $3, 'Acknowledged', CURRENT_TIMESTAMP)
    ON CONFLICT (policy_id, employee_id) DO UPDATE
      SET acknowledged_at = CURRENT_TIMESTAMP,
          acknowledged_version = EXCLUDED.acknowledged_version,
          status = 'Acknowledged'
    RETURNING *
  `,
    [policyId, employeeId, Number(version) || 1],
  );
  return rows[0];
}

/**
 * Employees who are in a published policy's audience and have NOT acknowledged
 * its CURRENT version yet (covers both never-acknowledged and superseded acks).
 * Audience is resolved via the shared buildAudienceWhere — not duplicated here.
 * Returns [] when the policy doesn't require acknowledgement.
 */
async function findAudienceEmployeesNeedingAck(pool, policy) {
  // Archived policies never solicit acknowledgements (also guards P3 reminders).
  if (policy.archivedAt || policy.archived_at) return [];
  const ackRequired = policy.ackRequired !== undefined ? policy.ackRequired !== false : policy.ack_required !== false;
  if (!ackRequired) return [];

  const config = parseAudienceConfig(policy.audienceConfig || policy.audience_config);
  const version = Number(policy.contentVersion || policy.content_version || 1);
  // $1 = policy id, $2 = current version, audience params start at $3.
  const { clause, params: audienceParams } = buildAudienceWhere(config, 3);
  const queryParams = [policy.id, version, ...audienceParams];

  const { rows } = await pool.query(
    `
    SELECT e.id, e.full_name
    FROM employees e
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = $1 AND pa.employee_id = e.id AND pa.acknowledged_version = $2::int
    WHERE e.deleted_at IS NULL
      AND (${clause})
      AND pa.id IS NULL
    ORDER BY e.full_name ASC
  `,
    queryParams,
  );
  return rows;
}

/* -------------------- P3: acknowledgement reminder scheduling --------------------
 * policy_ack_reminders is a TIMING/AUDIT clock only — a row exists while an
 * employee has an open "pending" episode for a policy. Ack status itself stays
 * version-computed (acknowledged_version vs content_version); these rows never
 * decide whether something is acknowledged.
 */

/** Start a pending episode for one (policy, employee) if not already tracked. */
async function ensureReminderRow(pool, policyId, employeeId) {
  await pool.query(
    `INSERT INTO policy_ack_reminders (policy_id, employee_id)
     VALUES ($1, $2)
     ON CONFLICT (policy_id, employee_id) DO NOTHING`,
    [policyId, employeeId],
  );
}

/** End a pending episode (called when the employee acknowledges the current version). */
async function clearReminderRow(pool, policyId, employeeId) {
  await pool.query(
    `DELETE FROM policy_ack_reminders WHERE policy_id = $1 AND employee_id = $2`,
    [policyId, employeeId],
  );
}

/** Record that a reminder was just sent (caps frequency within the cadence window). */
async function markReminderSent(pool, policyId, employeeId) {
  await pool.query(
    `UPDATE policy_ack_reminders SET last_reminded_at = NOW()
      WHERE policy_id = $1 AND employee_id = $2`,
    [policyId, employeeId],
  );
}

/**
 * Bulk self-heal: ensure a scheduling row exists for every employee currently in
 * the policy's audience who lacks a current-version ack. New rows start the clock
 * at NOW() (so they won't be reminded until a threshold later — no immediate spam);
 * existing rows keep their earlier first_pending_at via ON CONFLICT DO NOTHING.
 */
async function ensureReminderRowsForPolicy(pool, policy) {
  if (policy.archivedAt || policy.archived_at) return;
  const config = parseAudienceConfig(policy.audienceConfig || policy.audience_config);
  const version = Number(policy.contentVersion || policy.content_version || 1);
  const { clause, params: audienceParams } = buildAudienceWhere(config, 3);
  await pool.query(
    `
    INSERT INTO policy_ack_reminders (policy_id, employee_id)
    SELECT $1, e.id
    FROM employees e
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = $1 AND pa.employee_id = e.id AND pa.acknowledged_version = $2
    WHERE e.deleted_at IS NULL AND (${clause}) AND pa.id IS NULL
    ON CONFLICT (policy_id, employee_id) DO NOTHING
  `,
    [policy.id, version, ...audienceParams],
  );
}

/** Published, non-archived, ack-required policies — the reminder cron's work-list. */
async function findActivePoliciesForReminders(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM policies
      WHERE status = 'Published' AND archived_at IS NULL AND ack_required IS NOT FALSE
      ORDER BY id ASC`,
  );
  return rows.map(mapPolicyRow);
}

/**
 * Employees in the policy's audience who still lack a current-version ack AND
 * whose pending episode is older than `thresholdMs` AND who haven't been reminded
 * within `cadenceMs`. Joins the scheduling table for timing (so untracked pending
 * employees are not reminded — call ensureReminderRowsForPolicy first to enroll).
 */
async function findEmployeesDueForReminder(pool, policy, { thresholdMs, cadenceMs }) {
  if (policy.archivedAt || policy.archived_at) return [];
  const config = parseAudienceConfig(policy.audienceConfig || policy.audience_config);
  const version = Number(policy.contentVersion || policy.content_version || 1);
  const { clause, params: audienceParams } = buildAudienceWhere(config, 3);
  const thresholdIdx = 3 + audienceParams.length;
  const cadenceIdx = thresholdIdx + 1;
  const { rows } = await pool.query(
    `
    SELECT e.id, e.full_name, r.first_pending_at
    FROM employees e
    JOIN policy_ack_reminders r ON r.policy_id = $1 AND r.employee_id = e.id
    LEFT JOIN policy_acknowledgements pa
      ON pa.policy_id = $1 AND pa.employee_id = e.id AND pa.acknowledged_version = $2
    WHERE e.deleted_at IS NULL
      AND (${clause})
      AND pa.id IS NULL
      AND r.first_pending_at <= NOW() - ($${thresholdIdx}::bigint * INTERVAL '1 millisecond')
      AND (r.last_reminded_at IS NULL OR r.last_reminded_at <= NOW() - ($${cadenceIdx}::bigint * INTERVAL '1 millisecond'))
    ORDER BY e.full_name ASC
  `,
    [policy.id, version, ...audienceParams, Number(thresholdMs) || 0, Number(cadenceMs) || 0],
  );
  return rows;
}

/* -------------------- P4: review-date reminders -------------------- */

/**
 * Published, non-archived policies whose review_date is due within `leadDays`
 * (or already overdue) and which haven't been review-reminded within `cadenceMs`.
 */
async function findPoliciesDueForReview(pool, { leadDays, cadenceMs }) {
  const { rows } = await pool.query(
    `
    SELECT * FROM policies
     WHERE status = 'Published'
       AND archived_at IS NULL
       AND review_date IS NOT NULL
       AND review_date <= (CURRENT_DATE + ($1::int * INTERVAL '1 day'))
       AND (review_reminded_at IS NULL
            OR review_reminded_at <= NOW() - ($2::bigint * INTERVAL '1 millisecond'))
     ORDER BY review_date ASC
  `,
    [Number(leadDays) || 0, Number(cadenceMs) || 0],
  );
  return rows.map(mapPolicyRow);
}

/** Stamp that a review reminder was sent (caps frequency within the cadence window). */
async function markReviewReminded(pool, policyId) {
  await pool.query('UPDATE policies SET review_reminded_at = NOW() WHERE id = $1', [policyId]);
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
  computeContentHash,
  findAll,
  findAllArchived,
  findById,
  findEmployeeById,
  findPublishedForEmployee,
  findPublishedByIdForEmployee,
  create,
  update,
  remove,
  getAcknowledgements,
  acknowledge,
  findAudienceEmployeesNeedingAck,
  ensureReminderRow,
  clearReminderRow,
  markReminderSent,
  ensureReminderRowsForPolicy,
  findActivePoliciesForReminders,
  findEmployeesDueForReminder,
  findPoliciesDueForReview,
  markReviewReminded,
  listCategories,
  listCategoriesWithStats,
  createCategory,
  updateCategory,
  deleteCategory,
};
