'use strict';

async function findAllDocuments(pool) {
  const { rows } = await pool.query(
    `SELECT d.id, d.document_type, d.document_title, d.document_number,
            d.status, d.notes, d.file_url, d.file_name, d.version, d.rejection_reason,
            TO_CHAR(d.issue_date,  'YYYY-MM-DD') AS issue_date,
            TO_CHAR(d.expiry_date, 'YYYY-MM-DD') AS expiry_date,
            TO_CHAR(d.created_at,  'YYYY-MM-DD') AS submitted_date,
            e.id AS employee_id, e.full_name AS employee_name, e.emp_id AS emp_id, e.department
     FROM documents d
     JOIN employees e ON e.id = d.employee_id
     WHERE e.deleted_at IS NULL
     ORDER BY d.created_at DESC`
  );
  return rows;
}

async function findDocumentById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM documents WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateDocumentStatus(pool, id, { status, rejection_reason, actorId }) {
  const { rows } = await pool.query(
    `UPDATE documents
     SET status = $1,
         rejection_reason = $2,
         approved_by = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, status, rejection_reason`,
    [status, rejection_reason || null, actorId, id]
  );
  return rows[0];
}

async function insertAudit(pool, { document_id, action, actor_id, actor_name, detail }) {
  await pool.query(
    `INSERT INTO document_audit_log (document_id, action, actor_id, actor_name, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [document_id, action, actor_id || null, actor_name || null, detail || null]
  );
}

module.exports = { findAllDocuments, findDocumentById, updateDocumentStatus, insertAudit };
