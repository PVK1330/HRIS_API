'use strict';

const crypto = require('crypto');
const { DEFAULT_CHECKLIST, TOKEN_TTL_DAYS, WORKFLOW_STATUS } = require('./onboarding.workflow');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function findByToken(pool, token) {
  const { rows } = await pool.query(
    `SELECT e.*,
            m.full_name AS manager_name
     FROM employees e
     LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
     WHERE e.onboarding_token = $1
       AND e.deleted_at IS NULL
       AND (e.onboarding_token_expires_at IS NULL OR e.onboarding_token_expires_at > NOW())
     LIMIT 1`,
    [token],
  );
  return rows[0] || null;
}

/** Single source for onboarding column updates (HR + candidate flows). */
async function patchOnboardingFields(pool, employeeId, fields) {
  const sets = [];
  const params = [];

  if (fields.onboarding_step != null) {
    params.push(fields.onboarding_step);
    sets.push(
      `onboarding_step = GREATEST(COALESCE(onboarding_step, 0), $${params.length})`,
    );
  }
  const direct = [
    'onboarding_workflow_status',
    'onboarding_token',
    'onboarding_token_expires_at',
    'onboarding_approval_status',
    'onboarding_rejection_reason',
    'offer_letter_document_id',
    'signed_offer_document_id',
  ];
  for (const key of direct) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return;
  params.push(employeeId);
  await pool.query(
    `UPDATE employees SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );
}

const setWorkflowFields = patchOnboardingFields;

async function issueOnboardingToken(pool, employeeId) {
  const token = generateToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + TOKEN_TTL_DAYS);
  await setWorkflowFields(pool, employeeId, {
    onboarding_token: token,
    onboarding_token_expires_at: expires,
  });
  return { token, expiresAt: expires };
}

async function seedChecklist(pool, employeeId, extraItems = []) {
  const items = [...DEFAULT_CHECKLIST, ...extraItems];
  for (const item of items) {
    await pool.query(
      `INSERT INTO onboarding_checklist (
         employee_id, document_key, document_label, is_mandatory, sort_order
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, document_key) DO NOTHING`,
      [
        employeeId,
        item.document_key,
        item.document_label,
        item.is_mandatory !== false,
        item.sort_order ?? 0,
      ],
    );
  }
}

async function listChecklist(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT c.*, d.file_url, d.file_name, d.status AS document_status
     FROM onboarding_checklist c
     LEFT JOIN documents d ON d.id = c.document_id
     WHERE c.employee_id = $1
     ORDER BY c.sort_order ASC, c.id ASC`,
    [employeeId],
  );
  return rows;
}

async function findChecklistItem(pool, employeeId, documentKey) {
  const { rows } = await pool.query(
    `SELECT * FROM onboarding_checklist
     WHERE employee_id = $1 AND document_key = $2`,
    [employeeId, documentKey],
  );
  return rows[0] || null;
}

async function attachChecklistDocument(pool, employeeId, documentKey, documentId) {
  await pool.query(
    `UPDATE onboarding_checklist
     SET document_id = $3,
         upload_status = 'Uploaded',
         updated_at = NOW()
     WHERE employee_id = $1 AND document_key = $2`,
    [employeeId, documentKey, documentId],
  );
}

async function reviewChecklistItem(pool, itemId, { hrReviewStatus, hrReviewComment }) {
  await pool.query(
    `UPDATE onboarding_checklist
     SET hr_review_status = $2,
         hr_review_comment = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [itemId, hrReviewStatus, hrReviewComment || null],
  );

  const docRepo = require('../documents/documents.repository');
  await docRepo.syncStatusFromChecklistReview(
    pool,
    itemId,
    hrReviewStatus,
    hrReviewComment,
  );
}

async function allMandatoryChecklistApproved(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE hr_review_status = 'Approved'
            )::int AS approved
     FROM onboarding_checklist
     WHERE employee_id = $1 AND is_mandatory = true`,
    [employeeId],
  );
  const { total, approved } = rows[0] || { total: 0, approved: 0 };
  return total > 0 && total === approved;
}

module.exports = {
  findByToken,
  patchOnboardingFields,
  setWorkflowFields,
  issueOnboardingToken,
  seedChecklist,
  listChecklist,
  findChecklistItem,
  attachChecklistDocument,
  reviewChecklistItem,
  allMandatoryChecklistApproved,
  WORKFLOW_STATUS,
};
