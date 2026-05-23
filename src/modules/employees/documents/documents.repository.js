'use strict';

async function findByEmployee(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT d.id, d.document_type, d.document_title, d.document_number,
            d.status, d.notes, d.file_url, d.file_name, d.version,
            TO_CHAR(d.issue_date,  'YYYY-MM-DD') AS issue_date,
            TO_CHAR(d.expiry_date, 'YYYY-MM-DD') AS expiry_date,
            TO_CHAR(d.created_at,  'DD/MM/YYYY') AS "createdAt",
            a.full_name AS approved_by_name
     FROM documents d
     LEFT JOIN employees a ON a.id = d.approved_by AND a.deleted_at IS NULL
     WHERE d.employee_id = $1
     ORDER BY d.created_at DESC`,
    [employeeId]
  );
  return rows;
}

async function listActiveDocumentTypes(pool) {
  const { rows } = await pool.query(
    `SELECT id, name
     FROM document_types
     WHERE COALESCE(is_active, true) = true
     ORDER BY sort_order ASC NULLS LAST, created_at ASC`
  );
  return rows;
}

async function insertDocument(pool, row) {
  const {
    employee_id,
    document_type,
    document_title,
    document_number,
    issue_date,
    expiry_date,
    file_url,
    file_name,
    file_size,
    file_mime_type,
    notes,
  } = row;
  const { rows } = await pool.query(
    `INSERT INTO documents (
       employee_id, document_type, document_title, document_number,
       issue_date, expiry_date, file_url, file_name, file_size, file_mime_type,
       status, notes
     )
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, 'Pending', $11)
     RETURNING id, document_type, document_title, document_number, status, notes,
               file_url, file_name, version,
               TO_CHAR(issue_date,  'YYYY-MM-DD') AS issue_date,
               TO_CHAR(expiry_date, 'YYYY-MM-DD') AS expiry_date,
               TO_CHAR(created_at,  'DD/MM/YYYY') AS "createdAt"`,
    [
      employee_id,
      document_type,
      document_title,
      document_number || null,
      issue_date || null,
      expiry_date || null,
      file_url,
      file_name,
      file_size ?? null,
      file_mime_type || null,
      notes || null,
    ]
  );
  return rows[0] || null;
}

async function insertAudit(pool, { document_id, actor_id, actor_name, detail }) {
  await pool.query(
    `INSERT INTO document_audit_log (document_id, action, actor_id, actor_name, detail)
     VALUES ($1, 'Uploaded', $2, $3, $4)`,
    [document_id, actor_id || null, actor_name || null, detail || null]
  );
}

/** Mirror HR onboarding checklist decisions into documents.status for the profile tab. */
async function syncStatusFromChecklistReview(pool, checklistItemId, hrReviewStatus, hrReviewComment) {
  const docStatus =
    hrReviewStatus === 'Approved'
      ? 'Approved'
      : hrReviewStatus === 'Rejected'
        ? 'Rejected'
        : 'Pending';

  await pool.query(
    `UPDATE documents d
     SET status = $2,
         approved_at = CASE WHEN $2 = 'Approved' THEN COALESCE(d.approved_at, NOW()) ELSE NULL END,
         rejection_reason = CASE WHEN $2 = 'Rejected' THEN $3 ELSE NULL END,
         updated_at = NOW()
     FROM onboarding_checklist c
     WHERE c.id = $1 AND d.id = c.document_id`,
    [checklistItemId, docStatus, hrReviewComment || null],
  );
}

async function syncAllApprovedFromChecklist(pool, employeeId) {
  await pool.query(
    `UPDATE documents d
     SET status = 'Approved',
         approved_at = COALESCE(d.approved_at, NOW()),
         updated_at = NOW()
     FROM onboarding_checklist c
     WHERE c.employee_id = $1
       AND c.document_id = d.id
       AND c.hr_review_status = 'Approved'
       AND d.status IS DISTINCT FROM 'Approved'`,
    [employeeId],
  );
}

async function markDocumentsApproved(pool, documentIds, employeeId) {
  const ids = (documentIds || []).filter((id) => id != null);
  if (!ids.length) return;
  await pool.query(
    `UPDATE documents
     SET status = 'Approved',
         approved_at = COALESCE(approved_at, NOW()),
         updated_at = NOW()
     WHERE employee_id = $1 AND id = ANY($2::int[])`,
    [employeeId, ids],
  );
}

module.exports = {
  findByEmployee,
  listActiveDocumentTypes,
  insertDocument,
  insertAudit,
  syncStatusFromChecklistReview,
  syncAllApprovedFromChecklist,
  markDocumentsApproved,
};
