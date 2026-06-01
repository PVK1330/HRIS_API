'use strict';

/**
 * exitEvents — the single place that turns an exit lifecycle event into:
 *   • in-app notifications (notifications.service.pushNotification)
 *   • template-driven emails (helpers/mailer Mailer.send → public.email_templates)
 *   • assigned tasks (exit_tasks) for the stage's responsible person(s)
 *
 * Every handler is BEST-EFFORT: it is called AFTER the lifecycle transaction commits and is
 * wrapped so a notification / email / task failure never breaks the exit action itself.
 *
 * "Responsible person" for a stage = its explicit stage users (exit_stage_users) plus the
 * head (departments.manager_id) of each owning department. Role-only stages have no single
 * person, so they fall back to the admin (forAdmin) notification.
 */

const { getTenantPool } = require('../../config/db');

function notify() { return require('../notifications/notifications.service'); }

async function getCompanyName() {
  try {
    const settingsService = require('../settings/settings.service');
    const company = await settingsService.getSettingsByGroup('company');
    return company.companyName || 'Organization';
  } catch (_) { return 'Organization'; }
}

async function sendTemplate(to, templateSlug, variables) {
  if (!to) return;
  try {
    const { Mailer } = require('../../helpers/mailer/mailer');
    const mailer = await Mailer.getInstance();
    await mailer.send({ to, templateSlug, variables });
  } catch (_) { /* template missing / SMTP not configured — non-blocking */ }
}

async function pushSafe(tenant, payload) {
  try { await notify().pushNotification(tenant, payload); } catch (_) { /* non-blocking */ }
}

async function loadReq(pool, requestId) {
  const { rows } = await pool.query(
    `SELECT er.id, er.employee_id, er.exit_type, er.status, er.current_stage_id, er.rejection_reason,
            e.full_name, e.first_name, e.last_name, e.work_email, e.job_title,
            s.name AS stage_name
     FROM exit_requests er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN exit_workflow_stages s ON s.id = er.current_stage_id
     WHERE er.id = $1`,
    [requestId],
  );
  return rows[0] || null;
}

function fullName(r) {
  return r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'the employee';
}

async function resolveResponsibles(pool, stageId) {
  if (!stageId) return { recipients: [], primaryAssignee: null };
  // Responsible people for a stage = explicit stage users + owning-department heads +
  // employees holding any of the stage's owning roles (employees.rbac_role_id). Capped so a
  // broad role assignment cannot create a runaway number of tasks/emails.
  const { rows: recipients } = await pool.query(
    `SELECT DISTINCT e.id AS employee_id, e.full_name, e.work_email
     FROM employees e
     WHERE e.deleted_at IS NULL AND (
       e.id IN (SELECT employee_id FROM exit_stage_users WHERE stage_id = $1)
       OR e.id IN (SELECT d.manager_id FROM exit_stage_departments sd
                   JOIN departments d ON d.id = sd.department_id
                   WHERE sd.stage_id = $1 AND d.manager_id IS NOT NULL)
       OR e.rbac_role_id IN (SELECT role_id FROM exit_stage_roles WHERE stage_id = $1)
     )
     ORDER BY e.full_name
     LIMIT 50`,
    [stageId],
  );
  // Single assignee preference: explicit stage user → owning department head → a role holder.
  const explicit = await pool.query(
    `SELECT employee_id FROM exit_stage_users WHERE stage_id = $1 ORDER BY id ASC LIMIT 1`, [stageId],
  );
  let primaryAssignee = explicit.rows[0]?.employee_id || null;
  if (!primaryAssignee) {
    const head = await pool.query(
      `SELECT d.manager_id FROM exit_stage_departments sd
       JOIN departments d ON d.id = sd.department_id
       WHERE sd.stage_id = $1 AND d.manager_id IS NOT NULL
       ORDER BY sd.is_primary DESC, sd.id ASC LIMIT 1`, [stageId],
    );
    primaryAssignee = head.rows[0]?.manager_id || null;
  }
  if (!primaryAssignee) {
    const roleHolder = await pool.query(
      `SELECT e.id FROM employees e
       WHERE e.deleted_at IS NULL
         AND e.rbac_role_id IN (SELECT role_id FROM exit_stage_roles WHERE stage_id = $1)
       ORDER BY e.id ASC LIMIT 1`, [stageId],
    );
    primaryAssignee = roleHolder.rows[0]?.id || null;
  }
  return { recipients, primaryAssignee };
}

async function setPendingAssignee(pool, requestId, stageId, employeeId) {
  if (!employeeId) return;
  await pool.query(
    `UPDATE exit_approvals SET assigned_user_id = $3
     WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'PENDING' AND assigned_user_id IS NULL`,
    [requestId, stageId, employeeId],
  );
}

async function createStageTasks(pool, requestId, stageId, stageName, recipients) {
  for (const r of recipients) {
    if (!r.employee_id) continue;
    await pool.query(
      `INSERT INTO exit_tasks (exit_request_id, stage_id, assigned_to, title, status)
       SELECT $1, $2, $3, $4, 'PENDING'
       WHERE NOT EXISTS (
         SELECT 1 FROM exit_tasks
         WHERE exit_request_id = $1 AND stage_id = $2 AND assigned_to = $3 AND status = 'PENDING'
       )`,
      [requestId, stageId, r.employee_id, `Action required: ${stageName || 'Exit stage'}`],
    );
  }
}

async function closeRequestTasks(pool, requestId) {
  await pool.query(
    `UPDATE exit_tasks SET status = 'CLOSED', completed_at = NOW()
     WHERE exit_request_id = $1 AND status = 'PENDING'`,
    [requestId],
  );
}

/* ------------------------------------------------------------------ */
/*  Event handlers (best-effort)                                      */
/* ------------------------------------------------------------------ */

/** A request has just entered its current stage: assign + notify the responsible person(s). */
async function onStageEntered(tenant, requestId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req || !req.current_stage_id) return;
    const company = await getCompanyName();
    const empName = fullName(req);

    const { recipients, primaryAssignee } = await resolveResponsibles(pool, req.current_stage_id);
    await setPendingAssignee(pool, requestId, req.current_stage_id, primaryAssignee);
    await createStageTasks(pool, requestId, req.current_stage_id, req.stage_name, recipients);

    for (const r of recipients) {
      await pushSafe(tenant, {
        employeeId: r.employee_id, type: 'exit_management',
        title: 'Exit task assigned to you',
        message: `An exit request for ${empName} needs your action at the "${req.stage_name}" stage.`,
      });
      await sendTemplate(r.work_email, 'exit_stage_pending', {
        recipient_name: r.full_name || 'Colleague', employee_name: empName,
        job_title: req.job_title || '', stage_name: req.stage_name || '', company_name: company,
      });
    }
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit stage advanced',
      message: `${empName}'s exit request reached the "${req.stage_name}" stage.`,
    });
  } catch (_) { /* non-blocking */ }
}

async function onSubmitted(tenant, requestId) {
  // Stage 1 is active — create/assign its tasks + notify owners FIRST so tasks appear promptly
  // (this runs before the slower subject email below).
  await onStageEntered(tenant, requestId);
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompanyName();
    const empName = fullName(req);

    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'New exit request submitted',
      message: `${empName} submitted a ${req.exit_type} request.`,
    });
    await pushSafe(tenant, {
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit request submitted',
      message: `Your ${req.exit_type} request has been submitted and is now in progress.`,
    });
    await sendTemplate(req.work_email, 'exit_request_submitted', {
      employee_name: empName, exit_type: req.exit_type || 'exit', company_name: company,
    });
  } catch (_) { /* non-blocking */ }
}

async function onApproved(tenant, requestId, completed) {
  if (completed) return onCompleted(tenant, requestId);
  return onStageEntered(tenant, requestId);
}

async function onCompleted(tenant, requestId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompanyName();
    const empName = fullName(req);
    await closeRequestTasks(pool, requestId);
    await pushSafe(tenant, {
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit process completed', message: 'Your exit process has been completed.',
    });
    await sendTemplate(req.work_email, 'exit_request_completed', { employee_name: empName, company_name: company });
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit completed', message: `${empName}'s exit process is complete.`,
    });
  } catch (_) { /* non-blocking */ }
}

async function onRejected(tenant, requestId, reason) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompanyName();
    const empName = fullName(req);
    await closeRequestTasks(pool, requestId);
    await pushSafe(tenant, {
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit request rejected', message: `Your exit request was rejected. Reason: ${reason}`,
    });
    await sendTemplate(req.work_email, 'exit_request_rejected', {
      employee_name: empName, reason: reason || 'Not specified', company_name: company,
    });
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit request rejected', message: `${empName}'s exit request was rejected.`,
    });
  } catch (_) { /* non-blocking */ }
}

async function onWithdrawn(tenant, requestId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    await closeRequestTasks(pool, requestId);
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit request withdrawn', message: `${fullName(req)}'s exit request was withdrawn.`,
    });
  } catch (_) { /* non-blocking */ }
}

/** Ownership of the current stage was manually reassigned to another department. Notify +
 *  re-assign the task to the new owning department's head. */
async function onReassigned(tenant, requestId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req || !req.current_stage_id) return;
    const empName = fullName(req);
    const company = await getCompanyName();
    const { rows } = await pool.query(
      `SELECT d.manager_id, e.full_name, e.work_email
       FROM exit_requests er
       JOIN departments d ON d.id = er.current_owner_department_id
       LEFT JOIN employees e ON e.id = d.manager_id
       WHERE er.id = $1 AND d.manager_id IS NOT NULL`,
      [requestId],
    );
    const head = rows[0];
    if (head?.manager_id) {
      // Re-point the PENDING slot + raise a fresh task for the new owner.
      await pool.query(
        `UPDATE exit_approvals SET assigned_user_id = $3
         WHERE exit_request_id = $1 AND stage_id = $2 AND action = 'PENDING'`,
        [requestId, req.current_stage_id, head.manager_id],
      );
      await createStageTasks(pool, requestId, req.current_stage_id, req.stage_name,
        [{ employee_id: head.manager_id }]);
      await pushSafe(tenant, {
        employeeId: head.manager_id, type: 'exit_management',
        title: 'Exit reassigned to you',
        message: `An exit request for ${empName} at the "${req.stage_name}" stage has been reassigned to your department.`,
      });
      await sendTemplate(head.work_email, 'exit_stage_pending', {
        recipient_name: head.full_name || 'Colleague', employee_name: empName,
        job_title: req.job_title || '', stage_name: req.stage_name || '', company_name: company,
      });
    }
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit stage reassigned', message: `${empName}'s exit ("${req.stage_name}") was reassigned.`,
    });
  } catch (_) { /* non-blocking */ }
}

/** Current stage was escalated (manually). Notify the escalation target user + admin. */
async function onEscalated(tenant, requestId, escalationToUserId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const empName = fullName(req);
    if (escalationToUserId) {
      await pushSafe(tenant, {
        employeeId: escalationToUserId, type: 'exit_management',
        title: 'Exit stage escalated to you',
        message: `An exit stage ("${req.stage_name}") for ${empName} has been escalated to you.`,
      });
    }
    await pushSafe(tenant, {
      forAdmin: true, type: 'exit_management',
      title: 'Exit stage escalated', message: `${empName}'s exit ("${req.stage_name}") was escalated.`,
    });
  } catch (_) { /* non-blocking */ }
}

/** Called after exit documents are generated/emailed. */
async function onDocumentsSent(tenant, requestId, emailed) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    await pushSafe(tenant, {
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit documents issued',
      message: emailed ? 'Your exit documents have been generated and emailed to you.'
        : 'Your exit documents have been generated.',
    });
  } catch (_) { /* non-blocking */ }
}

/* ------------------------------------------------------------------ */
/*  Task queries (used by the tasks endpoints)                        */
/* ------------------------------------------------------------------ */

async function listMyTasks(tenant, employeeId, { status = 'PENDING' } = {}) {
  if (!employeeId) return [];
  const pool = await getTenantPool(tenant.dbName);
  const params = [employeeId];
  let where = 't.assigned_to = $1';
  if (status && status !== 'all') { params.push(status); where += ` AND t.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT t.id, t.exit_request_id, t.stage_id, t.title, t.status, t.created_at, t.completed_at,
            er.exit_type, er.status AS request_status,
            e.full_name AS employee_name, s.name AS stage_name
     FROM exit_tasks t
     JOIN exit_requests er ON er.id = t.exit_request_id
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN exit_workflow_stages s ON s.id = t.stage_id
     WHERE ${where}
     ORDER BY (t.status = 'PENDING') DESC, t.created_at DESC`,
    params,
  );
  return rows;
}

async function listRequestTasks(tenant, requestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT t.id, t.stage_id, t.title, t.status, t.assigned_to, t.created_at, t.completed_at,
            a.full_name AS assigned_to_name, s.name AS stage_name
     FROM exit_tasks t
     LEFT JOIN employees a ON a.id = t.assigned_to
     LEFT JOIN exit_workflow_stages s ON s.id = t.stage_id
     WHERE t.exit_request_id = $1
     ORDER BY (t.status = 'PENDING') DESC, t.created_at DESC`,
    [requestId],
  );
  return rows;
}

async function completeTask(tenant, taskId, exitUser) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(`SELECT * FROM exit_tasks WHERE id = $1`, [taskId]);
  const task = rows[0];
  const ApiError = require('../../utils/ApiError');
  if (!task) throw ApiError.notFound('Task not found');
  const isOwner = exitUser.employeeId && Number(task.assigned_to) === Number(exitUser.employeeId);
  if (!isOwner && !exitUser.isOrgExitAdmin) {
    throw ApiError.forbidden('You can only complete tasks assigned to you');
  }
  const { rows: upd } = await pool.query(
    `UPDATE exit_tasks SET status = 'COMPLETED', completed_at = NOW(), completed_by = $2
     WHERE id = $1 RETURNING *`,
    [taskId, exitUser.employeeId || null],
  );
  return upd[0];
}

module.exports = {
  onSubmitted, onApproved, onCompleted, onRejected, onWithdrawn, onStageEntered,
  onReassigned, onEscalated, onDocumentsSent,
  listMyTasks, listRequestTasks, completeTask,
};
