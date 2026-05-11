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

module.exports = { findByEmployee };
