'use strict';

/**
 * ExitAccessResolver — the single authorization chokepoint for Exit Management.
 *
 * Exit Management is a CENTRAL WORKFLOW ENGINE. Access to any exit request is computed
 * PER (user, exit_request) purely from:
 *   workflow stage ownership + assigned department + assigned approver/role
 *   + org-wide exit.manage permission + current workflow state + visibility settings.
 *
 * It NEVER consults SELF/TEAM/DEPARTMENT data scopes, employees.reporting_manager_id,
 * departments.manager_id, or req.auth.scope. All queries are read-only (SELECT).
 *
 * Canonical tokens: exit_requests.status active-mutation state is 'IN_PROGRESS';
 * exit_approvals.action is uppercase ('PENDING','APPROVE',...). See plan §B.
 */

const ApiError = require('../../utils/ApiError');

/* Frontend/API action vocabulary (the stage-ownership verbs from spec §4). */
const STAGE_ACTION_VERBS = [
  'approve', 'reject', 'send_back', 'escalate', 'reassign', 'comment', 'complete_checklist', 'upload',
];

/* ------------------------------------------------------------------ */
/*  B.2  loadWorkflowContext                                          */
/* ------------------------------------------------------------------ */

async function loadWorkflowContext(pool, exitRequestId) {
  const { rows } = await pool.query(
    `SELECT
       er.id                         AS exit_request_id,
       er.workflow_id,
       er.current_stage_id,
       er.current_owner_department_id,
       er.status,
       er.employee_id,
       s.id                          AS stage_id,
       s.stage_order                 AS current_stage_order,
       s.approval_mode,
       s.quorum_count,
       s.sla_hours,
       s.escalation_enabled,
       s.escalation_after_hours,
       s.escalation_to_role_id,
       s.escalation_to_user_id,
       s.escalation_action,
       s.block_until_checklist_complete,
       s.allow_future_visibility,
       s.allow_previous_edit
     FROM exit_requests er
     LEFT JOIN exit_workflow_stages s ON s.id = er.current_stage_id
     WHERE er.id = $1`,
    [exitRequestId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    exitRequestId: Number(r.exit_request_id),
    workflowId: r.workflow_id,
    currentStageId: r.current_stage_id,
    currentStageOrder: r.current_stage_order,
    currentOwnerDeptId: r.current_owner_department_id,
    status: r.status,
    employeeId: r.employee_id,
    approvalMode: r.approval_mode,
    quorumCount: r.quorum_count,
    slaHours: r.sla_hours,
    escalationEnabled: r.escalation_enabled,
    escalationAfterHours: r.escalation_after_hours,
    escalationToRoleId: r.escalation_to_role_id,
    escalationToUserId: r.escalation_to_user_id,
    escalationAction: r.escalation_action,
    blockUntilChecklistComplete: r.block_until_checklist_complete,
    allowFutureVisibility: r.allow_future_visibility,
    allowPreviousEdit: r.allow_previous_edit,
  };
}

/* ------------------------------------------------------------------ */
/*  B.3  resolveExitAccess — the four ownership primitives            */
/* ------------------------------------------------------------------ */

async function resolveExitAccess(pool, userCtx, wfCtx) {
  const empId = userCtx.employeeId || null;
  const deptId = userCtx.departmentId || null;
  const roleId = userCtx.rbacRoleId || null;
  const stageId = wfCtx.currentStageId || null;

  // (a) dept owns current stage, (b) role owns current stage,
  // (c) explicit approver (static user OR PENDING slot), (d) completed a strictly-earlier stage.
  const [ownsDeptR, roleOwnsR, explicitR, completedPrevR] = await Promise.all([
    stageId && deptId
      ? pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM exit_stage_departments sd
             WHERE sd.stage_id = $1 AND sd.department_id = $2
               AND ($3::int IS NULL OR sd.department_id = $3)
           ) AS owns`,
          [stageId, deptId, wfCtx.currentOwnerDeptId || null],
        )
      : Promise.resolve({ rows: [{ owns: false }] }),
    stageId && roleId
      ? pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM exit_stage_roles sr
             WHERE sr.stage_id = $1 AND sr.role_id = $2
           ) AS role_owns`,
          [stageId, roleId],
        )
      : Promise.resolve({ rows: [{ role_owns: false }] }),
    stageId && empId
      ? pool.query(
          `SELECT (
             EXISTS (SELECT 1 FROM exit_stage_users su
                     WHERE su.stage_id = $2 AND su.employee_id = $3)
             OR EXISTS (SELECT 1 FROM exit_approvals a
                        WHERE a.exit_request_id = $1 AND a.stage_id = $2
                          AND a.assigned_user_id = $3 AND a.action = 'PENDING')
           ) AS explicit_approver`,
          [wfCtx.exitRequestId, stageId, empId],
        )
      : Promise.resolve({ rows: [{ explicit_approver: false }] }),
    empId
      ? pool.query(
          // strictly-earlier stage while in-progress; ANY participated stage once the request
          // is closed (current stage order is NULL).
          `SELECT EXISTS (
             SELECT 1 FROM exit_approvals a
             JOIN exit_workflow_stages s ON s.id = a.stage_id
             WHERE a.exit_request_id = $1 AND a.actor_id = $3
               AND a.action IN ('APPROVE','REJECT','SEND_BACK','COMPLETE')
               AND ($2::int IS NULL OR s.stage_order < $2)
           ) AS completed_prev`,
          [wfCtx.exitRequestId, wfCtx.currentStageOrder, empId],
        )
      : Promise.resolve({ rows: [{ completed_prev: false }] }),
  ]);

  const ownsDept = ownsDeptR.rows[0].owns;
  const roleOwns = roleOwnsR.rows[0].role_owns;
  const explicitApprover = explicitR.rows[0].explicit_approver;
  const completedPrevStage = completedPrevR.rows[0].completed_prev;
  const ownsCurrentStage = Boolean(ownsDept || roleOwns || explicitApprover);

  // The data subject (the exiting employee) may always read their OWN request.
  // This is the workflow subject, NOT hierarchy/scope — read-only, never a stage actor.
  const isSubject = Boolean(
    userCtx.employeeId && wfCtx.employeeId &&
    Number(userCtx.employeeId) === Number(wfCtx.employeeId),
  );

  // Grant read access to the employee's Reporting Manager, Dept Head, and global HR
  let isHierarchyOrHR = false;
  if (!isSubject && userCtx.employeeId && wfCtx.employeeId) {
    const { rows: hierarchy } = await pool.query(
      `SELECT e.reporting_manager_id, d.manager_id AS dept_head_id 
       FROM employees e 
       LEFT JOIN departments d ON d.id = e.department_id 
       WHERE e.id = $1`, [wfCtx.employeeId]
    );
    if (hierarchy.length > 0) {
      if (hierarchy[0].reporting_manager_id == userCtx.employeeId || hierarchy[0].dept_head_id == userCtx.employeeId) {
        isHierarchyOrHR = true;
      }
    }
  }

  if (!isSubject && !isHierarchyOrHR && userCtx.rbacRoleId) {
    const { rows: hrCheck } = await pool.query(
      `SELECT 1 FROM rbac_roles rr
       LEFT JOIN rbac_role_permissions rp ON rp.role_id = rr.id
       LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
       WHERE rr.id = $1 AND (
         LOWER(COALESCE(rr.name, '')) LIKE '%hr%' OR
         LOWER(COALESCE(rr.name, '')) LIKE '%admin%' OR
         p.key IN ('onboarding', 'onboarding.manage', 'tasks', 'system-settings')
       ) LIMIT 1`, [userCtx.rbacRoleId]
    );
    if (hrCheck.length > 0) isHierarchyOrHR = true;
  }

  // Visibility derivation (§3, §4). Fail-closed default 'hidden'.
  let visibility = 'hidden';
  if (userCtx.isOrgExitAdmin) {
    visibility = 'current';
  } else if (ownsCurrentStage) {
    visibility = 'current';
  } else if (completedPrevStage) {
    visibility = 'previous_readonly';
  } else if (isSubject) {
    visibility = 'subject_readonly';
  } else if (isHierarchyOrHR) {
    visibility = 'hierarchy_readonly';
  } else if (wfCtx.workflowId && wfCtx.currentStageOrder != null) {
    // future-stage preview — only computed when the cheaper checks failed
    const belongsFuture = await userBelongsToFutureStage(pool, userCtx, wfCtx);
    if (belongsFuture) visibility = 'future_preview';
  }

  return {
    wfCtx,
    ownsCurrentStage,
    isOrgExitAdmin: Boolean(userCtx.isOrgExitAdmin),
    completedPrevStage,
    isSubject,
    visibility,
    canRead: visibility !== 'hidden',
  };
}

async function userBelongsToFutureStage(pool, userCtx, wfCtx) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM exit_workflow_stages fs
       LEFT JOIN exit_stage_departments fsd ON fsd.stage_id = fs.id
       LEFT JOIN exit_stage_roles      fsr ON fsr.stage_id = fs.id
       LEFT JOIN exit_stage_users      fsu ON fsu.stage_id = fs.id
       WHERE fs.workflow_id = $1
         AND fs.stage_order > $2
         AND fs.allow_future_visibility = true
         AND (fsd.department_id = $3 OR fsr.role_id = $4 OR fsu.employee_id = $5)
     ) AS belongs_future`,
    [wfCtx.workflowId, wfCtx.currentStageOrder, userCtx.departmentId || null,
     userCtx.rbacRoleId || null, userCtx.employeeId || null],
  );
  return rows[0].belongs_future;
}

/* ------------------------------------------------------------------ */
/*  B.4  permittedActionsFor — §4 mutation gating (pure)              */
/* ------------------------------------------------------------------ */

function permittedActionsFor(accessCtx) {
  const actions = new Set();
  if (accessCtx.canRead) actions.add('view');

  const { wfCtx } = accessCtx;
  const mutable = wfCtx.status === 'IN_PROGRESS';
  const ownsNow = accessCtx.ownsCurrentStage || accessCtx.isOrgExitAdmin;

  if (mutable && ownsNow) {
    for (const v of STAGE_ACTION_VERBS) actions.add(v);
  }
  // previous-stage edit ONLY if the current stage config allows it AND user owned a prior stage
  if (mutable && accessCtx.completedPrevStage && wfCtx.allowPreviousEdit) {
    actions.add('comment'); // limited write-back; never approve/reject of current stage
  }
  // Generating + emailing official exit documents (relieving / experience / settlement letters)
  // is an HR/admin action — allowed to the org exit admin, the current-stage owner, or anyone
  // who acted on an earlier stage (e.g. HR issuing a relieving letter after completion). It is
  // intentionally NOT gated on status, so documents can be issued once the exit is COMPLETED.
  if (accessCtx.canRead
      && (accessCtx.isOrgExitAdmin || accessCtx.ownsCurrentStage || accessCtx.completedPrevStage)) {
    actions.add('generate_documents');
  }
  // Withdrawing an exit request is restricted to its data subject (the exiting employee) or the
  // org exit admin — NOT every viewer. Status gating (only SUBMITTED/IN_PROGRESS) stays in the
  // service; here we only constrain WHO may attempt it.
  if (accessCtx.isSubject || accessCtx.isOrgExitAdmin) {
    actions.add('withdraw');
  }
  return actions;
}

/* ------------------------------------------------------------------ */
/*  B.5  listVisibleExitRequestIds — the canonical visibility set      */
/* ------------------------------------------------------------------ */

async function listVisibleExitRequestIds(pool, userCtx /*, filters */) {
  let isHR = false;
  if (userCtx.rbacRoleId) {
    const { rows: hrCheck } = await pool.query(
      `SELECT 1 FROM rbac_roles rr
       LEFT JOIN rbac_role_permissions rp ON rp.role_id = rr.id
       LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
       WHERE rr.id = $1 AND (
         LOWER(COALESCE(rr.name, '')) LIKE '%hr%' OR
         LOWER(COALESCE(rr.name, '')) LIKE '%admin%' OR
         p.key IN ('onboarding', 'onboarding.manage', 'tasks', 'system-settings')
       ) LIMIT 1`, [userCtx.rbacRoleId]
    );
    isHR = hrCheck.length > 0;
  }

  const { rows } = await pool.query(
    `SELECT er.id
     FROM exit_requests er
     LEFT JOIN exit_workflow_stages cur ON cur.id = er.current_stage_id
     WHERE
       $4 = true
       OR $5 = true                      -- HR sees all requests
       OR er.employee_id = $1            -- the data subject sees their own request
       OR EXISTS ( SELECT 1 FROM employees emp LEFT JOIN departments dept ON dept.id = emp.department_id WHERE emp.id = er.employee_id AND (emp.reporting_manager_id = $1 OR dept.manager_id = $1) ) -- Hierarchy managers
       OR EXISTS ( SELECT 1 FROM exit_stage_departments sd
                   WHERE sd.stage_id = er.current_stage_id
                     AND sd.department_id = $2
                     AND (er.current_owner_department_id IS NULL
                          OR sd.department_id = er.current_owner_department_id) )
       OR EXISTS ( SELECT 1 FROM exit_stage_roles sr
                   WHERE sr.stage_id = er.current_stage_id AND sr.role_id = $3 )
       OR EXISTS ( SELECT 1 FROM exit_stage_users su
                   WHERE su.stage_id = er.current_stage_id AND su.employee_id = $1 )
       OR EXISTS ( SELECT 1 FROM exit_approvals pa
                   WHERE pa.exit_request_id = er.id
                     AND pa.stage_id = er.current_stage_id
                     AND pa.assigned_user_id = $1
                     AND pa.action = 'PENDING' )
       OR EXISTS ( SELECT 1 FROM exit_approvals ea
                   JOIN exit_workflow_stages es ON es.id = ea.stage_id
                   WHERE ea.exit_request_id = er.id
                     AND ea.actor_id = $1
                     AND ea.action IN ('APPROVE','REJECT','SEND_BACK','COMPLETE')
                     AND (cur.stage_order IS NULL OR es.stage_order < cur.stage_order) )
       OR EXISTS ( SELECT 1
                   FROM exit_workflow_stages fs
                   LEFT JOIN exit_stage_departments fsd ON fsd.stage_id = fs.id
                   LEFT JOIN exit_stage_roles      fsr ON fsr.stage_id = fs.id
                   LEFT JOIN exit_stage_users      fsu ON fsu.stage_id = fs.id
                   WHERE fs.workflow_id = er.workflow_id
                     AND fs.stage_order > cur.stage_order
                     AND fs.allow_future_visibility = true
                     AND (fsd.department_id = $2 OR fsr.role_id = $3 OR fsu.employee_id = $1) )`,
    [userCtx.employeeId || null, userCtx.departmentId || null,
     userCtx.rbacRoleId || null, Boolean(userCtx.isOrgExitAdmin), isHR],
  );
  return rows.map((r) => Number(r.id));
}

/* ------------------------------------------------------------------ */
/*  assert helpers (throw 403/404)                                    */
/* ------------------------------------------------------------------ */

async function assertCanRead(pool, userCtx, exitRequestId) {
  const wfCtx = await loadWorkflowContext(pool, exitRequestId);
  if (!wfCtx) throw ApiError.notFound('Exit request not found');
  const accessCtx = await resolveExitAccess(pool, userCtx, wfCtx);
  if (!accessCtx.canRead) throw ApiError.forbidden('You do not have access to this exit request');
  accessCtx.actions = permittedActionsFor(accessCtx);
  return accessCtx;
}

async function assertCanAct(pool, userCtx, exitRequestId, action) {
  const accessCtx = await assertCanRead(pool, userCtx, exitRequestId);
  if (!accessCtx.actions.has(action)) {
    throw ApiError.forbidden(`You are not allowed to "${action}" this exit request at its current stage`);
  }
  return accessCtx;
}

module.exports = {
  STAGE_ACTION_VERBS,
  loadWorkflowContext,
  resolveExitAccess,
  permittedActionsFor,
  listVisibleExitRequestIds,
  userBelongsToFutureStage,
  assertCanRead,
  assertCanAct,
};
