'use strict';

/**
 * exitStageEngine — stage-advance algorithm + status transitions for the workflow engine.
 *
 * Single status state machine (canonical tokens):
 *   DRAFT -> SUBMITTED -> IN_PROGRESS -> COMPLETED   (+ terminal REJECTED / WITHDRAWN / CANCELLED)
 * Per-stage position is exit_requests.current_stage_id; per-stage progress is in exit_approvals.
 * IN_PROGRESS is the ONLY state in which stage actions are permitted.
 *
 * All functions here take a transaction `client` (caller owns BEGIN/COMMIT).
 * exit_approvals.action is uppercase: PENDING/APPROVE/REJECT/SEND_BACK/ESCALATE/REASSIGN/COMMENT/COMPLETE.
 */

/* ---- stage definition + ordering helpers ---- */

async function getStage(client, stageId) {
  const { rows } = await client.query(
    `SELECT * FROM exit_workflow_stages WHERE id = $1`, [stageId],
  );
  return rows[0] || null;
}

async function getFirstStage(client, workflowId) {
  const { rows } = await client.query(
    `SELECT * FROM exit_workflow_stages
     WHERE workflow_id = $1 AND is_active = true
     ORDER BY stage_order ASC, id ASC LIMIT 1`,
    [workflowId],
  );
  return rows[0] || null;
}

async function getNextStage(client, workflowId, currentOrder) {
  const { rows } = await client.query(
    `SELECT * FROM exit_workflow_stages
     WHERE workflow_id = $1 AND is_active = true AND stage_order > $2
     ORDER BY stage_order ASC, id ASC LIMIT 1`,
    [workflowId, currentOrder],
  );
  return rows[0] || null;
}

async function getStageByOrder(client, workflowId, order) {
  const { rows } = await client.query(
    `SELECT * FROM exit_workflow_stages
     WHERE workflow_id = $1 AND stage_order = $2 LIMIT 1`,
    [workflowId, order],
  );
  return rows[0] || null;
}

async function primaryDeptForStage(client, stageId) {
  const { rows } = await client.query(
    `SELECT department_id FROM exit_stage_departments
     WHERE stage_id = $1
     ORDER BY is_primary DESC, id ASC LIMIT 1`,
    [stageId],
  );
  return rows[0]?.department_id ?? null;
}

/* ---- approval-mode satisfaction ---- */

async function requiredApproverCount(client, stageId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM exit_stage_departments WHERE stage_id = $1)
     + (SELECT COUNT(*) FROM exit_stage_roles       WHERE stage_id = $1)
     + (SELECT COUNT(*) FROM exit_stage_users       WHERE stage_id = $1) AS required`,
    [stageId],
  );
  return Number(rows[0].required) || 0;
}

/** Count approvals for the CURRENT occurrence of this stage (since stage_entered_at). */
async function approvalsThisOccurrence(client, requestId, stageId, stageEnteredAt) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM exit_approvals
     WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'APPROVE'
       AND ($3::timestamptz IS NULL OR created_at >= $3)`,
    [requestId, stageId, stageEnteredAt || null],
  );
  return rows[0].n;
}

async function isStageSatisfied(client, request, stage) {
  const approvals = await approvalsThisOccurrence(client, request.id, stage.id, request.stage_entered_at);
  const required = await requiredApproverCount(client, stage.id);
  switch (stage.approval_mode) {
    case 'ANY':        return approvals >= 1;
    case 'QUORUM':     return approvals >= (stage.quorum_count || 1);
    case 'ALL':        return required > 0 ? approvals >= required : approvals >= 1;
    case 'SEQUENTIAL': return required > 0 ? approvals >= required : approvals >= 1;
    default:           return approvals >= 1;
  }
}

/** Every MANDATORY checklist item for (request, stage) resolved? */
async function isChecklistComplete(client, requestId, stageId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS pending
     FROM exit_request_checklist_items
     WHERE exit_request_id = $1 AND stage_id = $2
       AND is_mandatory = true
       AND status NOT IN ('COMPLETED','SKIPPED','NA')`,
    [requestId, stageId],
  );
  return rows[0].pending === 0;
}

/* ---- stage entry: pointers + PENDING slot + checklist seeding ---- */

async function seedStageEntry(client, requestId, stage) {
  const deptId = await primaryDeptForStage(client, stage.id);
  const slaDue = stage.sla_hours
    ? `NOW() + (${Number(stage.sla_hours)} || ' hours')::interval`
    : 'NULL';

  await client.query(
    `UPDATE exit_requests
       SET current_stage_id = $1,
           current_owner_department_id = $2,
           status = 'IN_PROGRESS',
           stage_entered_at = NOW(),
           updated_at = NOW()
     WHERE id = $3`,
    [stage.id, deptId, requestId],
  );

  // Open PENDING slot for the stage occurrence (authoritative SLA clock).
  await client.query(
    `INSERT INTO exit_approvals
       (exit_request_id, stage_id, department_id, action, actor_name, sla_due_at)
     VALUES ($1, $2, $3, 'PENDING', 'System', ${slaDue})`,
    [requestId, stage.id, deptId],
  );

  // Instantiate stage checklist templates into per-request items.
  await client.query(
    `INSERT INTO exit_request_checklist_items
       (exit_request_id, stage_id, template_item_id, item_type, label, is_mandatory, status)
     SELECT $1, t.stage_id, t.id, t.item_type, t.label, t.is_mandatory, 'PENDING'
     FROM exit_stage_checklist_items t
     WHERE t.stage_id = $2 AND t.is_active = true`,
    [requestId, stage.id],
  );

  // If this stage is IT or Asset Clearance, dynamically fetch employee's assigned assets and insert them as checklist items.
  const stageName = (stage.name || '').toLowerCase();
  if (stageName.includes('it clearance') || stageName.includes('asset') || stageName.includes('it admin')) {
    const { rows: reqRows } = await client.query('SELECT employee_id FROM exit_requests WHERE id = $1', [requestId]);
    if (reqRows.length > 0) {
      const empId = reqRows[0].employee_id;
      try {
        // Query assets assigned to the employee
        const { rows: assets } = await client.query(`SELECT id, asset_name, asset_code FROM assets WHERE employee_id = $1 AND status = 'ASSIGNED'`, [empId]);
        for (const asset of assets) {
          await client.query(
            `INSERT INTO exit_request_checklist_items
               (exit_request_id, stage_id, template_item_id, item_type, label, is_mandatory, status)
             VALUES ($1, $2, NULL, 'COLLECT_ASSET', $3, true, 'PENDING')`,
            [requestId, stage.id, `Collect Asset: ${asset.asset_name} (${asset.asset_code})`]
          );
        }
      } catch (e) {
        // Fallback or ignore if assets table does not strictly exist
        console.error('Error fetching assets for clearance', e);
      }
    }
  }

  return deptId;
}

/** Close the open PENDING slot for a stage occurrence (mark consumed by the decision). */
async function closePendingSlot(client, requestId, stageId, action, actorId) {
  await client.query(
    `UPDATE exit_approvals
       SET action = $3, acted_at = NOW(), actor_id = COALESCE(actor_id, $4)
     WHERE id = (
       SELECT id FROM exit_approvals
       WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'PENDING'
       ORDER BY id ASC LIMIT 1
     )`,
    [requestId, stageId, action, actorId || null],
  );
}

/* ---- the advance algorithm ---- */

/**
 * Attempt to advance the request past its current stage. Returns one of:
 *   { advanced:false, reason } | { advanced:true, completed:false, nextStageId }
 *   | { advanced:true, completed:true }
 * Caller must already hold the transaction and have inserted the APPROVE row.
 */
async function advanceStage(client, request, stage) {
  // 1. checklist gate
  if (stage.block_until_checklist_complete) {
    const ok = await isChecklistComplete(client, request.id, stage.id);
    if (!ok) return { advanced: false, reason: 'checklist_incomplete' };
  }
  // 2. approval-mode satisfaction
  const satisfied = await isStageSatisfied(client, request, stage);
  if (!satisfied) return { advanced: false, reason: 'approvals_pending' };

  // 3. mark stage COMPLETE + close the PENDING slot
  await closePendingSlot(client, request.id, stage.id, 'APPROVE', null);
  await client.query(
    `INSERT INTO exit_approvals (exit_request_id, stage_id, action, actor_name, acted_at)
     VALUES ($1, $2, 'COMPLETE', 'System', NOW())`,
    [request.id, stage.id],
  );

  // 4/5. next stage or finish
  const next = await getNextStage(client, request.workflow_id, stage.stage_order);
  if (next) {
    await seedStageEntry(client, request.id, next);
    return { advanced: true, completed: false, nextStageId: next.id };
  }

  await client.query(
    `UPDATE exit_requests
       SET current_stage_id = NULL, current_owner_department_id = NULL,
           status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [request.id],
  );
  // end-of-exit side effect: mark the employee separated
  await client.query(
    `UPDATE employees SET employment_status = 'Terminated', updated_at = NOW() WHERE id = $1`,
    [request.employee_id],
  );
  return { advanced: true, completed: true };
}

/** Move the request backward to an earlier stage (send-back); resets the SLA clock. */
async function moveToStage(client, request, targetStage) {
  await seedStageEntry(client, request.id, targetStage);
}

module.exports = {
  getStage,
  getFirstStage,
  getNextStage,
  getStageByOrder,
  primaryDeptForStage,
  requiredApproverCount,
  isStageSatisfied,
  isChecklistComplete,
  seedStageEntry,
  closePendingSlot,
  advanceStage,
  moveToStage,
};
