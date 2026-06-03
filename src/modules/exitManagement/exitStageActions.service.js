'use strict';

/**
 * Stage-attached actions — checklist completion + attachments. Clearance / asset return /
 * interview / settlement all live as exit_request_checklist_items (discriminated by item_type,
 * type-specific payload in data JSONB). Replaces clearance.service.js / assetRecovery.service.js.
 *
 * Authorization is enforced by the route chain (authorizeExitAccess) BEFORE these run — the
 * caller already owns the current stage. These functions assume that guard passed.
 */

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

async function listChecklist(tenant, requestId, stageId) {
  const pool = await getTenantPool(tenant.dbName);
  const params = [requestId];
  let sql = `SELECT ci.*, e.full_name AS completed_by_name
             FROM exit_request_checklist_items ci
             LEFT JOIN employees e ON e.id = ci.completed_by
             WHERE ci.exit_request_id = $1`;
  if (stageId) { params.push(stageId); sql += ` AND ci.stage_id = $2`; }
  sql += ` ORDER BY ci.stage_id, ci.id`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function addChecklistItem(tenant, requestId, stageId, data) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `INSERT INTO exit_request_checklist_items
       (exit_request_id, stage_id, item_type, label, is_mandatory, status, assigned_to, due_date, notes, data)
     VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9) RETURNING *`,
    [requestId, stageId, data.item_type || 'TASK', String(data.label).trim(),
     data.is_mandatory !== false, data.assigned_to || null, data.due_date || null,
     data.notes || null, data.data ? JSON.stringify(data.data) : '{}'],
  );
  return rows[0];
}

async function updateChecklistItem(tenant, requestId, stageId, itemId, data, actor) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows: existing } = await pool.query(
    `SELECT * FROM exit_request_checklist_items WHERE id = $1 AND exit_request_id = $2 AND stage_id = $3`,
    [itemId, requestId, stageId],
  );
  if (!existing.length) throw ApiError.notFound('Checklist item not found');

  const fields = [];
  const params = [];
  let n = 1;
  for (const f of ['label', 'notes', 'assigned_to', 'due_date']) {
    if (data[f] !== undefined) { params.push(data[f]); fields.push(`${f} = $${n++}`); }
  }
  if (data.data !== undefined) { params.push(JSON.stringify(data.data)); fields.push(`data = $${n++}`); }
  if (data.status !== undefined) {
    params.push(data.status); fields.push(`status = $${n++}`);
    if (data.status === 'COMPLETED') {
      fields.push('completed_at = NOW()');
      params.push(actor?.employeeId || null); fields.push(`completed_by = $${n++}`);
    } else {
      fields.push('completed_at = NULL', 'completed_by = NULL');
    }
  }
  if (!fields.length) return existing[0];
  fields.push('updated_at = NOW()');
  params.push(itemId);
  const { rows } = await pool.query(
    `UPDATE exit_request_checklist_items SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`, params,
  );
  return rows[0];
}

/* ------------------------------------------------------------------ */
/*  Asset clearance — surface the exiting employee's assigned assets    */
/*  so an ASSET_RETURN clearance stage shows real items to return.      */
/* ------------------------------------------------------------------ */

async function getRequestEmployeeId(pool, requestId) {
  const { rows } = await pool.query(
    `SELECT employee_id FROM exit_requests WHERE id = $1`, [requestId],
  );
  if (!rows.length) throw ApiError.notFound('Exit request not found');
  return rows[0].employee_id;
}

/** Every asset currently/previously assigned to the exiting employee. Outstanding
 *  ('Issued') first so the clearance owner sees what is still to be collected. */
async function listEmployeeAssets(tenant, requestId) {
  const pool = await getTenantPool(tenant.dbName);
  const employeeId = await getRequestEmployeeId(pool, requestId);
  const { rows } = await pool.query(
    `SELECT id, asset_tag, asset_name, category, serial_number, condition, status,
            assigned_date, returned_date, notes
     FROM employee_assets
     WHERE employee_id = $1
     ORDER BY (status = 'Issued') DESC, category, asset_name`,
    [employeeId],
  );
  const outstanding = rows.filter((r) => r.status === 'Issued').length;
  return { assets: rows, outstanding, total: rows.length };
}

/** Mark one of the employee's assets returned (clearance action). Guarded by the route's
 *  authorizeExitAccess({action:'complete_checklist'}) — the caller owns the current stage. */
async function markAssetReturned(tenant, requestId, assetId, data, actor) {
  const pool = await getTenantPool(tenant.dbName);
  const employeeId = await getRequestEmployeeId(pool, requestId);

  const { rows: existing } = await pool.query(
    `SELECT * FROM employee_assets WHERE id = $1 AND employee_id = $2`,
    [assetId, employeeId],
  );
  if (!existing.length) throw ApiError.notFound('Asset not found for this employee');

  // status: 'Returned' (default) — but allow recording 'Lost'/'Damaged', or reverting to 'Issued'.
  const status = ['Issued', 'Returned', 'Lost', 'Damaged'].includes(data.status)
    ? data.status : 'Returned';

  const { rows } = await pool.query(
    `UPDATE employee_assets
       SET status = $1,
           returned_date = ${status === 'Issued' ? 'NULL' : 'CURRENT_DATE'},
           condition = COALESCE($2, condition),
           notes = COALESCE($3, notes),
           updated_at = NOW()
     WHERE id = $4 AND employee_id = $5
     RETURNING id, asset_tag, asset_name, category, serial_number, condition, status,
               assigned_date, returned_date, notes`,
    [status, data.condition || null, data.notes || null, assetId, employeeId],
  );
  const updated = rows[0];
  if (updated && status === 'Returned') {
    const assetsService = require('../assets/assets.service');
    assetsService.logAssetReturned(
      tenant,
      assetId,
      employeeId,
      { employeeId: actor?.employeeId, actorName: actor?.actorName },
      { status, notes: data.notes },
    ).catch(() => null);
  }
  return updated;
}

async function addAttachment(tenant, requestId, stageId, file, meta, actor) {
  const pool = await getTenantPool(tenant.dbName);
  if (!file) throw ApiError.badRequest('No file uploaded');
  const fileUrl = `/uploads/exit-stage-attachments/${tenant.dbName}/${file.filename}`;
  const { rows } = await pool.query(
    `INSERT INTO exit_request_attachments
       (exit_request_id, stage_id, checklist_item_id, attachment_type, file_url, file_name, mime_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [requestId, stageId || null, meta.checklist_item_id || null, meta.attachment_type || 'GENERIC',
     fileUrl, file.originalname, file.mimetype, actor?.employeeId || null],
  );
  return rows[0];
}

async function listAttachments(tenant, requestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT a.*, e.full_name AS uploaded_by_name
     FROM exit_request_attachments a LEFT JOIN employees e ON e.id = a.uploaded_by
     WHERE a.exit_request_id = $1 ORDER BY a.uploaded_at DESC`, [requestId],
  );
  return rows;
}

module.exports = {
  listChecklist,
  addChecklistItem,
  updateChecklistItem,
  listEmployeeAssets,
  markAssetReturned,
  addAttachment,
  listAttachments,
};
