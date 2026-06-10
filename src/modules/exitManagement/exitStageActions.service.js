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
const logger = require('../../utils/logger');

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

/** Every asset currently/previously assigned to the exiting employee, read from the
 *  `assets` source-of-truth table (the Asset Management module's live assignment table;
 *  `employee_assets` is legacy and no longer written, so seeding/list/return must all use
 *  `assets` to stay in sync). Columns are aliased to the response contract the UI already
 *  consumes (asset_tag/asset_name/category) and the assets-vocabulary status 'Assigned' is
 *  surfaced as 'Issued' so the existing UI (which keys on 'Issued'/'Returned') is unchanged.
 *  Outstanding ('Issued') first so the clearance owner sees what is still to be collected. */
async function listEmployeeAssets(tenant, requestId) {
  const pool = await getTenantPool(tenant.dbName);
  const employeeId = await getRequestEmployeeId(pool, requestId);
  const { rows } = await pool.query(
    `SELECT a.id,
            a.asset_id                                               AS asset_tag,
            COALESCE(ac.name, a.type)                                AS asset_name,
            ac.name                                                  AS category,
            a.serial_number,
            a.condition,
            CASE WHEN a.status = 'Assigned' THEN 'Issued' ELSE a.status END AS status,
            a.issue_date                                             AS assigned_date,
            NULL::date                                               AS returned_date,
            a.notes
     FROM assets a
     LEFT JOIN asset_categories ac ON ac.id = a.category_id
     WHERE a.employee_id = $1
     ORDER BY (a.status = 'Assigned') DESC, ac.name, a.type`,
    [employeeId],
  );
  const outstanding = rows.filter((r) => r.status === 'Issued').length;
  return { assets: rows, outstanding, total: rows.length };
}

/** Mark one of the employee's assets returned (clearance action) on the `assets`
 *  source-of-truth table, and keep the seeded ASSET_RETURN checklist item in lock-step so a
 *  block_until_checklist_complete stage can actually advance. Asset write + checklist update run
 *  in one transaction (so the two never drift). The UI speaks the legacy vocabulary
 *  ('Issued'/'Returned'); we map it to the assets vocabulary ('Assigned'/'Returned') on write.
 *  Guarded by the route's authorizeExitAccess({action:'complete_checklist'}). */
async function markAssetReturned(tenant, requestId, assetId, data, actor) {
  const pool = await getTenantPool(tenant.dbName);
  const employeeId = await getRequestEmployeeId(pool, requestId);

  // Map the UI status onto the assets-table vocabulary. 'Issued' (the UI's "undo" value)
  // means "still assigned" → 'Assigned'. Anything unexpected defaults to 'Returned'.
  const UI_TO_ASSET = { Issued: 'Assigned', Returned: 'Returned', Lost: 'Lost', Damaged: 'Damaged' };
  const assetStatus = UI_TO_ASSET[data.status] || 'Returned';
  const stillOutstanding = assetStatus === 'Assigned';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      `SELECT id FROM assets WHERE id = $1 AND employee_id = $2`,
      [assetId, employeeId],
    );
    if (!existing.length) throw ApiError.notFound('Asset not found for this employee');

    // `assets` has no returned_date column, and we keep employee_id so the asset still shows
    // in the employee's clearance list (rendered line-through once returned). updated_at marks it.
    const { rows } = await client.query(
      `UPDATE assets
         SET status = $1,
             condition = COALESCE($2, condition),
             notes = COALESCE($3, notes),
             updated_at = NOW()
       WHERE id = $4 AND employee_id = $5
       RETURNING id,
                 asset_id AS asset_tag,
                 type     AS asset_name,
                 serial_number,
                 condition,
                 CASE WHEN status = 'Assigned' THEN 'Issued' ELSE status END AS status,
                 notes`,
      [assetStatus, data.condition || null, data.notes || null, assetId, employeeId],
    );

    // Keep the seeded ASSET_RETURN checklist item in lock-step with the asset, matched by the
    // asset PK stored in data.asset_id at seed time (exitStageEngine.seedStageEntry):
    //   returned/lost/damaged -> COMPLETED (clears the block_until_checklist_complete gate)
    //   reverted to Assigned  -> PENDING   (re-blocks the gate)
    if (stillOutstanding) {
      await client.query(
        `UPDATE exit_request_checklist_items
            SET status = 'PENDING', completed_at = NULL, completed_by = NULL, updated_at = NOW()
          WHERE exit_request_id = $1 AND item_type = 'ASSET_RETURN' AND data->>'asset_id' = $2`,
        [requestId, String(assetId)],
      );
    } else {
      await client.query(
        `UPDATE exit_request_checklist_items
            SET status = 'COMPLETED', completed_at = NOW(), completed_by = $1, updated_at = NOW()
          WHERE exit_request_id = $2 AND item_type = 'ASSET_RETURN' AND data->>'asset_id' = $3
            AND status NOT IN ('COMPLETED','SKIPPED','NA')`,
        [actor?.employeeId || null, requestId, String(assetId)],
      );
    }

    await client.query('COMMIT');

    const updated = rows[0];
    if (updated && assetStatus === 'Returned') {
      const assetsService = require('../assets/assets.service');
      assetsService.logAssetReturned(
        tenant,
        assetId,
        employeeId,
        { employeeId: actor?.employeeId, actorName: actor?.actorName },
        { status: assetStatus, notes: data.notes },
      ).catch((e) => { logger.error('[exit] workflow event error', { err: e.message }); return null; });
    }
    return updated;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* tx already aborted */ }
    throw e;
  } finally {
    client.release();
  }
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
