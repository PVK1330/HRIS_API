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
const env = require('../../config/env');
const delivery = require('../notifications/notificationDelivery.service');
const workflowAudit = require('../workflow/workflowAudit.service');
const { getHROrAdminRecipients } = require('../employees/onboarding/utils/onboardingRecipients.utils');
const logger = require('../../utils/logger');

function notify() { return require('../notifications/notifications.service'); }

async function getCompany(tenant) {
  try {
    const tenantSettingsService = require('../tenantSettings/tenantSettings.service');
    const tenantSettings = await tenantSettingsService.getAdminSettings(tenant.dbName, '');
    return {
      companyName: tenantSettings.companyName || tenant.companyName || 'Organisation',
      companyLogo: tenantSettings.logoUrl || '',
    };
  } catch (_) { 
    return { companyName: tenant ? tenant.companyName : 'Organisation', companyLogo: '' }; 
  }
}

async function sendTemplate(tenant, to, templateSlug, variables, attachments = []) {
  if (!to) return;
  try {
    const { Mailer } = require('../../helpers/mailer/mailer');
    const mailer = await Mailer.getInstance();
    await mailer.send({ to, templateSlug, variables, attachments, tenant });
  } catch (mailErr) {
    logger.warn('[exitEvents] template email failed', { to, templateSlug, err: mailErr.message });
  }
}

async function pushSafe(tenant, payload, dedupMeta) {
  try {
    const meta = dedupMeta || {
      tenantId: tenant?.id,
      notificationType: payload.type || 'exit_management',
      entityType: payload.entityType || 'exit_request',
      entityId: payload.entityId,
      recipientId: payload.employeeId ?? null,
    };
    await delivery.sendDedupedInApp(tenant, {
      ...payload,
      type: payload.type || 'exit_management',
    }, meta);
    logger.info('[exit] push notification queued', { notificationType: meta.notificationType, recipientId: meta.recipientId, entityId: meta.entityId });
  } catch (err) {
    logger.error('[exit] pushSafe error', { err: err.message });
  }
}

async function emailSafe(tenant, to, templateSlug, variables, dedupMeta) {
  if (!to) return;
  await delivery.sendDedupedEmailOnly(tenant, { to, templateSlug, variables }, dedupMeta);
}

async function loadReq(pool, requestId) {
  const { rows } = await pool.query(
    `SELECT er.id, er.employee_id, er.exit_type, er.status, er.current_stage_id, er.rejection_reason,
            e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.reporting_manager_id AS reporting_to,
            d.manager_id AS dept_head_id,
            s.name AS stage_name
     FROM exit_requests er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN exit_workflow_stages s ON s.id = er.current_stage_id
     WHERE er.id = $1`,
    [requestId],
  );
  return rows[0] || null;
}

function fullName(r) {
  return r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'the employee';
}

async function resolveResponsibles(tenant, stageId, requestId) {
  if (!stageId) return { recipients: [], primaryAssignee: null };
  const pool = await getTenantPool(tenant.dbName);
  
  let recipients = [];
  let primaryAssignee = null;
  let stageName = '';

  const { rows: stageRows } = await pool.query(
    `SELECT name, dynamic_owner_type FROM exit_workflow_stages WHERE id = $1`, 
    [stageId]
  );
  if (stageRows.length) stageName = stageRows[0].name;

  // 1. Check for dynamic owner (Reporting Manager / Dept Head)
  if (requestId && stageRows.length) {
    const ownerType = stageRows[0].dynamic_owner_type;
    const isReportingManager = ownerType === 'REPORTING_MANAGER' || (!ownerType && stageName.toLowerCase().includes('reporting manager'));
    const isDeptHead = ownerType === 'DEPT_HEAD' || (!ownerType && stageName.toLowerCase().includes('department head'));

    if (isReportingManager || isDeptHead) {
      const req = await loadReq(pool, requestId);
      if (req) {
        if (isReportingManager && req.reporting_to) {
          primaryAssignee = req.reporting_to;
        } else if (isDeptHead && req.dept_head_id) {
          primaryAssignee = req.dept_head_id;
        }
        if (primaryAssignee) {
          const { rows: p } = await pool.query(`SELECT id AS employee_id, full_name, work_email FROM employees WHERE id = $1`, [primaryAssignee]);
          if (p.length) recipients = p;
        }
      }
    }
  }

  // 2. If no dynamic owner, try standard DB lookup
  if (!recipients.length) {
    const { rows: r } = await pool.query(
      `SELECT DISTINCT e.id AS employee_id, e.full_name, e.work_email
       FROM employees e
       WHERE e.deleted_at IS NULL AND (
         e.id IN (SELECT employee_id FROM exit_stage_users WHERE stage_id = $1)
         OR e.id IN (SELECT d.manager_id FROM exit_stage_departments sd
                     JOIN departments d ON d.id = sd.department_id
                     WHERE sd.stage_id = $1 AND d.manager_id IS NOT NULL)
         OR e.rbac_role_id IN (SELECT role_id FROM exit_stage_roles WHERE stage_id = $1)
       )
       ORDER BY e.full_name LIMIT 50`,
      [stageId],
    );
    recipients = r;
    
    if (recipients.length) {
      const explicit = await pool.query(`SELECT employee_id FROM exit_stage_users WHERE stage_id = $1 ORDER BY id ASC LIMIT 1`, [stageId]);
      primaryAssignee = explicit.rows[0]?.employee_id || null;
      if (!primaryAssignee) {
        const head = await pool.query(`SELECT d.manager_id FROM exit_stage_departments sd JOIN departments d ON d.id = sd.department_id WHERE sd.stage_id = $1 AND d.manager_id IS NOT NULL ORDER BY sd.is_primary DESC, sd.id ASC LIMIT 1`, [stageId]);
        primaryAssignee = head.rows[0]?.manager_id || null;
      }
      if (!primaryAssignee) {
        const roleHolder = await pool.query(`SELECT e.id FROM employees e WHERE e.deleted_at IS NULL AND e.rbac_role_id IN (SELECT role_id FROM exit_stage_roles WHERE stage_id = $1) ORDER BY e.id ASC LIMIT 1`, [stageId]);
        primaryAssignee = roleHolder.rows[0]?.id || null;
      }
    }
  }

  // 3. Fallback to HR/Admin + Logging
  if (!recipients.length) {
    const fallback = await pool.query(
      `SELECT DISTINCT e.id AS employee_id, e.full_name, e.work_email
       FROM employees e LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
       WHERE e.deleted_at IS NULL AND (LOWER(COALESCE(rr.name, '')) LIKE '%admin%' OR LOWER(COALESCE(rr.name, '')) LIKE '%hr%')
       ORDER BY e.id LIMIT 10`,
    );
    const fallbackRecipients = fallback.rows || [];
    if (fallbackRecipients.length) {
      recipients = fallbackRecipients;
      primaryAssignee = fallbackRecipients[0].employee_id || null;

      if (requestId) {
        await workflowAudit.log(tenant, {
          module: 'exit', action: 'owner_resolution_failed', entityType: 'exit_request', entityId: requestId,
          detail: { stageName, fallback: 'Assigned to HR/Admin' },
        });
        await pushSafe(tenant, { priority: 'HIGH', forAdmin: true, type: 'exit_management',
          title: 'Exit Stage Missing Owner',
          message: `Stage "${stageName}" had no resolved owners. It was reassigned to the HR/Admin fallback.`,
          entityType: 'exit_request', entityId: requestId, redirectUrl: `/admin/exit-management/${requestId}`
        });
      }
    } else {
      throw new Error(`Failed to resolve any responsible owner or fallback for stage ${stageName} (ID: ${stageId}).`);
    }
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
  const dueDays = Number.isFinite(env.EXIT_TASK_DUE_DAYS) ? env.EXIT_TASK_DUE_DAYS : 7;
  
  const { rows: checklistItems } = await pool.query(
    `SELECT id, label, is_mandatory FROM exit_request_checklist_items WHERE exit_request_id = $1 AND stage_id = $2 AND status = 'PENDING'`,
    [requestId, stageId]
  );

  for (const r of recipients) {
    if (!r.employee_id) continue;
    
    if (checklistItems.length > 0) {
      for (const item of checklistItems) {
        await pool.query(
          `INSERT INTO exit_tasks (exit_request_id, stage_id, assigned_to, title, description, status, due_at)
           SELECT $1, $2, $3, $4, $5, 'PENDING', (NOW() + make_interval(days => $6::int))
           WHERE NOT EXISTS (
             SELECT 1 FROM exit_tasks
             WHERE exit_request_id = $1 AND stage_id = $2 AND assigned_to = $3 AND title = $4 AND status = 'PENDING'
           )`,
          [requestId, stageId, r.employee_id, item.label, `Checklist item ID: ${item.id}`, dueDays],
        );
        logger.debug('[exit] created checklist task', { itemId: item.id, stageId, employeeId: r.employee_id });
      }
    } else {
      await pool.query(
        `INSERT INTO exit_tasks (exit_request_id, stage_id, assigned_to, title, status, due_at)
         SELECT $1, $2, $3, $4, 'PENDING', (NOW() + make_interval(days => $5::int))
         WHERE NOT EXISTS (
           SELECT 1 FROM exit_tasks
           WHERE exit_request_id = $1 AND stage_id = $2 AND assigned_to = $3 AND status = 'PENDING'
         )`,
        [requestId, stageId, r.employee_id, `Review Exit Request: ${stageName || 'Stage'}`, dueDays],
      );
      logger.debug('[exit] created review task', { stageId, employeeId: r.employee_id });
    }
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
async function onStageEntered(tenant, requestId, options = {}) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req || !req.current_stage_id) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);

    const { recipients, primaryAssignee } = await resolveResponsibles(tenant, req.current_stage_id, requestId);
    await setPendingAssignee(pool, requestId, req.current_stage_id, primaryAssignee);
    const taskRecipients = recipients.length
      ? recipients
      : (primaryAssignee ? [{ employee_id: primaryAssignee }] : []);
    await createStageTasks(pool, requestId, req.current_stage_id, req.stage_name, taskRecipients);

    if (options.skipBroadcast) return;

    for (const r of recipients) {
      await pushSafe(tenant, { priority: 'NORMAL',
        employeeId: r.employee_id,
        title: 'Exit task assigned to you',
        message: `An exit request for ${empName} needs your action at the "${req.stage_name}" stage.`,
        entityType: 'exit_request',
        entityId: requestId,
        redirectUrl: `/admin/exit-management/${requestId}`,
      }, {
        notificationType: 'exit.stage_entered.owner',
        entityType: 'exit_request',
        entityId: `${requestId}_stage_${req.current_stage_id}`,
        recipientId: r.employee_id,
      });
      await emailSafe(tenant, r.work_email, 'exit_stage_pending', {
        recipient_name: r.full_name || 'Colleague',
        employee_name: empName,
        job_title: req.job_title || '',
        stage_name: req.stage_name || '',
        company_name: company.companyName,
      }, {
        notificationType: 'exit.stage_entered.owner.email',
        entityType: 'exit_request',
        entityId: `${requestId}_stage_${req.current_stage_id}`,
        recipientId: r.employee_id,
      });
    }
    await pushSafe(tenant, { priority: 'NORMAL',
      forAdmin: true,
      title: 'Exit stage advanced',
      message: `${empName}'s exit request reached the "${req.stage_name}" stage.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.stage_entered.admin',
      entityType: 'exit_request',
      entityId: `${requestId}_stage_${req.current_stage_id}`,
      recipientId: null,
    });
  } catch (notifyErr) {
    logger.warn('[exitEvents] stage-entered notifications failed', { requestId, err: notifyErr.message });
  }
}

async function onSubmitted(tenant, requestId) {
  // Stage 1 is active — create/assign its tasks + notify owners FIRST so tasks appear promptly
  await onStageEntered(tenant, requestId);
  
  const pool = await getTenantPool(tenant.dbName);
  const req = await loadReq(pool, requestId);
  if (!req) return;
  const company = await getCompany(tenant);
  const empName = fullName(req);

  const hrAdmins = await getHROrAdminRecipients(pool);

  // loadReq aliases reporting_manager_id AS reporting_to (line ~77), so the manager id lives
  // on req.reporting_to — reading req.reporting_manager_id here was always undefined, so the
  // manager notification silently never sent.
  const notifyList = [
    { id: req.reporting_to, role: 'Manager' },
    { id: req.dept_head_id, role: 'Department Head' }
  ].filter(x => x.id && x.id !== req.employee_id);

  // Notify Employee (Push + Email)
  await pushSafe(tenant, { priority: 'NORMAL',
    employeeId: req.employee_id, type: 'exit_management', priority: 'NORMAL',
    title: 'Exit request submitted',
    message: `Your ${req.exit_type} request has been submitted and is now in progress.`,
    entityType: 'exit_request',
    entityId: requestId,
    redirectUrl: `/admin/exit-management/${requestId}`
  });
  
  await emailSafe(tenant, req.work_email, 'exit_request_submitted', {
    employee_name: empName,
    exit_type: req.exit_type || 'exit',
    company_name: company.companyName,
  }, {
    notificationType: 'exit.submitted.employee.email',
    entityType: 'exit_request',
    entityId: requestId,
    recipientId: req.employee_id,
  });

  // Notify Manager and Dept Head (Push + Email)
  for (const recipient of notifyList) {
    await pushSafe(tenant, { priority: 'HIGH',
      employeeId: recipient.id, type: 'exit_management',
      title: 'Exit request submitted',
      message: `${empName} submitted a ${req.exit_type} request.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    });
    
    // Fetch their email
    const { rows: eRows } = await pool.query(`SELECT work_email FROM employees WHERE id = $1`, [recipient.id]);
    if (eRows.length && eRows[0].work_email) {
      await emailSafe(tenant, eRows[0].work_email, 'exit_request_submitted', {
        employee_name: empName,
        exit_type: req.exit_type || 'exit',
        company_name: company.companyName,
      }, {
        notificationType: 'exit.submitted.manager.email',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: recipient.id,
      });
    }
  }

  // Notify HR / Admins (Push + Email)
  for (const admin of hrAdmins) {
    if (admin.id === req.employee_id) continue;
    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: admin.id, type: 'exit_management',
      title: 'New exit request submitted',
      message: `${empName} submitted a ${req.exit_type} request.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    });
    
    if (admin.work_email) {
      await emailSafe(tenant, admin.work_email, 'exit_request_submitted', {
        employee_name: empName,
        exit_type: req.exit_type || 'exit',
        company_name: company.companyName,
      }, {
        notificationType: 'exit.submitted.admin.email',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: admin.id,
      });
    }
  }

  await workflowAudit.log(tenant, {
    module: 'exit',
    action: 'submitted',
    entityType: 'exit_request',
    entityId: requestId,
    detail: { exitType: req.exit_type },
  });
}

async function onApproved(tenant, requestId, completed) {
  if (completed) return onCompleted(tenant, requestId);
  const pool = await getTenantPool(tenant.dbName);
  const req = await loadReq(pool, requestId);
  
  if (req) {
    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit stage approved',
      message: `Your exit request has successfully passed the "${req.stage_name}" stage.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    }, {
      notificationType: 'exit.stage_approved.employee',
      entityType: 'exit_request',
      entityId: `${requestId}_stage_${req.current_stage_id}`,
      recipientId: req.employee_id,
    });
  }

  return onStageEntered(tenant, requestId);
}

async function onCompleted(tenant, requestId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);
    await closeRequestTasks(pool, requestId);

    let attachments = [];
    let documentsEmailed = false;
    try {
      const exitDocuments = require('./exitDocuments.service');
      let docs = await exitDocuments.listGenerated(tenant, requestId);
      
      if (docs.length === 0) {
        const templates = await exitDocuments.listTemplates(tenant);
        if (templates.length > 0) {
          const res = await exitDocuments.generate(tenant, requestId, {
            template_ids: templates.map(t => t.id),
            // Completion requirement: issue and email exit documents immediately.
            send_email: true
          }, { actorName: 'System' });
          documentsEmailed = !!res?.emailed;
          docs = await exitDocuments.listGenerated(tenant, requestId);
        }
      }
      if (!documentsEmailed && docs.length > 0) {
        const fs = require('fs');
        const path = require('path');
        const env = require('../../config/env');
        for (const doc of docs) {
          const rel = String(doc.file_url).replace(/^\/uploads\//, '');
          const absPath = path.resolve(env.UPLOAD.dir, rel);
          if (fs.existsSync(absPath)) {
            attachments.push({
              filename: doc.file_name,
              content: fs.readFileSync(absPath)
            });
          }
        }
        if (attachments.length && req.work_email) {
          await sendTemplate(tenant, req.work_email, 'exit_request_completed', {
            employee_name: empName,
            company_name: company.companyName,
            app_name: company.companyName,
            company_logo: company.companyLogo
          }, attachments);
          documentsEmailed = true;
        }
      }
    } catch (err) {
      logger.error('[exit] document auto-generation failed', { err: err.message });
    }

    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit process completed', message: 'Your exit process has been completed.',
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    });
    if (!documentsEmailed) {
      await sendTemplate(tenant, req.work_email, 'exit_request_completed', {
        employee_name: empName,
        company_name: company.companyName,
        app_name: company.companyName,
        company_logo: company.companyLogo
      }, attachments);
    }
    await pushSafe(tenant, { priority: 'NORMAL',
      forAdmin: true,
      title: 'Exit completed',
      message: `${empName}'s exit process is complete.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.completed.admin',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: null,
    });

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'completed',
      entityType: 'exit_request',
      entityId: requestId,
    });

    // Epic P3: Employee Deactivation Workflow — mark the employee separated using the SAME
    // canonical field set as advanceStage / restored by withdraw (see exitSeparation.util),
    // so completion and withdraw stay in lock-step.
    try {
      const separation = require('./exitSeparation.util');
      await separation.markEmployeeSeparated(pool, req.employee_id);
      logger.info('[exit] employee deactivated', { employeeId: req.employee_id });
    } catch (e) {
      logger.error('[exit] failed to deactivate employee account', { err: e.message });
    }
  } catch (_) { /* non-blocking */ }
}

async function onRejected(tenant, requestId, reason) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);
    const reasonText = reason ? `\nReason: ${reason}` : '';
    await closeRequestTasks(pool, requestId);
    await pushSafe(tenant, { priority: 'HIGH',
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit request rejected', message: `Your exit request was rejected.${reasonText}`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    });
    await sendTemplate(tenant, req.work_email, 'exit_request_rejected', {
      employee_name: empName,
      company_name: company.companyName,
      app_name: company.companyName,
      company_logo: company.companyLogo,
      reason: reason || 'Not specified',
    });
    await pushSafe(tenant, { priority: 'HIGH',
      forAdmin: true,
      title: 'Exit request rejected',
      message: `${empName}'s exit request was rejected.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.rejected.admin',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: null,
    });

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'rejected',
      entityType: 'exit_request',
      entityId: requestId,
      detail: { reason: reason || '' },
    });
  } catch (_) { /* non-blocking */ }
}

async function onWithdrawn(tenant, requestId, reason) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);
    const reasonText = reason || 'Withdrawn by request owner';
    await closeRequestTasks(pool, requestId);

    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id,
      title: 'Exit request withdrawn',
      message: 'Your exit request has been withdrawn.',
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.withdrawn.employee',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: req.employee_id,
    });

    if (req.work_email) {
      await emailSafe(tenant, req.work_email, 'exit_request_withdrawn', {
        recipient_name: empName,
        employee_name: empName,
        reason: reasonText,
        company_name: company.companyName,
      }, {
        notificationType: 'exit.withdrawn.employee.email',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: req.employee_id,
      });
    }

    const stageId = req.current_stage_id;
    if (stageId) {
      const { recipients } = await resolveResponsibles(tenant, stageId, requestId);
      for (const r of recipients) {
        await pushSafe(tenant, { priority: 'NORMAL',
          employeeId: r.employee_id,
          title: 'Exit request withdrawn',
          message: `${empName}'s exit request was withdrawn. ${reasonText}`,
          entityType: 'exit_request',
          entityId: requestId,
          redirectUrl: `/admin/exit-management/${requestId}`,
        }, {
          notificationType: 'exit.withdrawn.owner',
          entityType: 'exit_request',
          entityId: requestId,
          recipientId: r.employee_id,
        });
        if (r.work_email) {
          await emailSafe(tenant, r.work_email, 'exit_request_withdrawn', {
            recipient_name: r.full_name || 'Colleague',
            employee_name: empName,
            reason: reasonText,
            company_name: company.companyName,
          }, {
            notificationType: 'exit.withdrawn.owner.email',
            entityType: 'exit_request',
            entityId: requestId,
            recipientId: r.employee_id,
          });
        }
      }
    }

    const hrAdmins = await getHROrAdminRecipients(pool);
    for (const admin of hrAdmins) {
      await pushSafe(tenant, { priority: 'NORMAL',
        employeeId: admin.id,
        title: 'Exit request withdrawn',
        message: `${empName}'s exit request was withdrawn.`,
        entityType: 'exit_request',
        entityId: requestId,
        redirectUrl: `/admin/exit-management/${requestId}`,
      }, {
        notificationType: 'exit.withdrawn.hr',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: admin.id,
      });
    }

    await pushSafe(tenant, { priority: 'NORMAL',
      forAdmin: true,
      title: 'Exit request withdrawn',
      message: `${empName}'s exit request was withdrawn.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.withdrawn.admin',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: null,
    });

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'withdrawn',
      entityType: 'exit_request',
      entityId: requestId,
      detail: { reason: reasonText },
    });
  } catch (_) { /* non-blocking */ }
}

async function onSendBack(tenant, requestId, { reason, exitUser } = {}) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req || !req.current_stage_id) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);
    const senderName = exitUser?.actorName || exitUser?.full_name || 'Approver';
    const reasonText = reason || 'Revision required';

    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id,
      title: 'Your exit request has been sent back for revision.',
      message: `Reason: ${reasonText}. From: ${senderName}`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.sent_back.employee',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: req.employee_id,
    });

    if (req.work_email) {
      await emailSafe(tenant, req.work_email, 'exit_request_sent_back', {
        recipient_name: empName,
        employee_name: empName,
        stage_name: req.stage_name || '',
        reason: reasonText,
        sender_name: senderName,
        company_name: company.companyName,
      }, {
        notificationType: 'exit.sent_back.employee.email',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: req.employee_id,
      });
    }

    const { recipients } = await resolveResponsibles(tenant, req.current_stage_id, requestId);
    for (const r of recipients) {
      await pushSafe(tenant, { priority: 'NORMAL',
        employeeId: r.employee_id,
        title: 'Exit request sent back for revision',
        message: `${empName}'s request was sent back at "${req.stage_name}". ${reasonText}`,
        entityType: 'exit_request',
        entityId: requestId,
        redirectUrl: `/admin/exit-management/${requestId}`,
      }, {
        notificationType: 'exit.sent_back.approver',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: r.employee_id,
      });
      if (r.work_email) {
        await emailSafe(tenant, r.work_email, 'exit_request_sent_back', {
          recipient_name: r.full_name || 'Colleague',
          employee_name: empName,
          stage_name: req.stage_name || '',
          reason: reasonText,
          sender_name: senderName,
          company_name: company.companyName,
        }, {
          notificationType: 'exit.sent_back.approver.email',
          entityType: 'exit_request',
          entityId: requestId,
          recipientId: r.employee_id,
        });
      }
    }

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'sent_back',
      entityType: 'exit_request',
      entityId: requestId,
      actorEmployeeId: exitUser?.employeeId || null,
      actorName: senderName,
      detail: { reason: reasonText, stage: req.stage_name },
    });
  } catch (_) { /* non-blocking */ }
}

async function onCommentAdded(tenant, requestId, { comment, exitUser } = {}) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    const company = await getCompany(tenant);
    const empName = fullName(req);
    const senderName = exitUser?.actorName || 'User';
    const commentText = String(comment || '').trim();

    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id,
      title: 'New comment on your exit request',
      message: `${senderName}: ${commentText}`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.comment.employee',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: req.employee_id,
    });

    if (req.work_email) {
      await emailSafe(tenant, req.work_email, 'exit_comment_added', {
        recipient_name: empName,
        employee_name: empName,
        sender_name: senderName,
        comment: commentText,
        company_name: company.companyName,
      }, {
        notificationType: 'exit.comment.employee.email',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: req.employee_id,
      });
    }

    if (req.current_stage_id) {
      const { recipients } = await resolveResponsibles(tenant, req.current_stage_id, requestId);
      for (const r of recipients) {
        if (r.employee_id === exitUser?.employeeId) continue;
        await pushSafe(tenant, { priority: 'NORMAL',
          employeeId: r.employee_id,
          title: 'New exit request comment',
          message: `${senderName} on ${empName}: ${commentText}`,
          entityType: 'exit_request',
          entityId: requestId,
          redirectUrl: `/admin/exit-management/${requestId}`,
        }, {
          notificationType: 'exit.comment.approver',
          entityType: 'exit_request',
          entityId: requestId,
          recipientId: r.employee_id,
        });
        if (r.work_email) {
          await emailSafe(tenant, r.work_email, 'exit_comment_added', {
            recipient_name: r.full_name || 'Colleague',
            employee_name: empName,
            sender_name: senderName,
            comment: commentText,
            company_name: company.companyName,
          }, {
            notificationType: 'exit.comment.approver.email',
            entityType: 'exit_request',
            entityId: requestId,
            recipientId: r.employee_id,
          });
        }
      }
    }

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'comment_added',
      entityType: 'exit_request',
      entityId: requestId,
      actorEmployeeId: exitUser?.employeeId || null,
      actorName: senderName,
      detail: { comment: commentText },
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
    const company = await getCompany(tenant);
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
      await pushSafe(tenant, { priority: 'NORMAL',
        employeeId: head.manager_id, type: 'exit_management',
        title: 'Exit reassigned to you',
        message: `An exit request for ${empName} at the "${req.stage_name}" stage has been reassigned to your department.`,
        entityType: 'exit_request',
        entityId: requestId,
        redirectUrl: `/admin/exit-management/${requestId}`
      });
      await sendTemplate(tenant, head.work_email, 'exit_stage_pending', {
        recipient_name: head.full_name || 'Colleague', employee_name: empName,
        job_title: req.job_title || '', stage_name: req.stage_name || '', company_name: company.companyName,
      });
    }
    await pushSafe(tenant, { priority: 'NORMAL',
      forAdmin: true, type: 'exit_management',
      title: 'Exit stage reassigned', message: `${empName}'s exit ("${req.stage_name}") was reassigned.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
    });
  } catch (_) { /* non-blocking */ }
}

/** Current stage was escalated (manually). Notify the escalation target user + admin. */
async function onEscalated(tenant, requestId, escalationTargetUserId) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req || !req.current_stage_id) return;
    const empName = fullName(req);
    
    // Notify the target user if specified
    if (escalationTargetUserId) {
      await pushSafe(tenant, { priority: 'HIGH',
        employeeId: escalationTargetUserId, type: 'exit_management',
        title: 'Exit Request Escalated',
        message: `${empName}'s exit request at stage "${req.stage_name}" has breached SLA and was escalated to you.`,
        entityType: 'exit_request',
        entityId: requestId,
        redirectUrl: `/admin/exit-management/${requestId}`
      }, {
        notificationType: 'exit.escalated.target',
        entityType: 'exit_request',
        entityId: requestId,
        recipientId: escalationTargetUserId,
      });
    }

    // Notify Admins
    await pushSafe(tenant, { priority: 'HIGH',
      forAdmin: true,
      title: 'Exit Request Escalated',
      message: `${empName}'s exit request at stage "${req.stage_name}" has breached SLA and was escalated.`,
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`,
    }, {
      notificationType: 'exit.escalated.admin',
      entityType: 'exit_request',
      entityId: requestId,
      recipientId: null,
    });
    
  } catch (_) { /* non-blocking */ }
}

/** Called after exit documents are generated/emailed. */
async function onDocumentsSent(tenant, requestId, emailed) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const req = await loadReq(pool, requestId);
    if (!req) return;
    await pushSafe(tenant, { priority: 'NORMAL',
      employeeId: req.employee_id, type: 'exit_management',
      title: 'Exit documents issued',
      message: emailed ? 'Your exit documents have been generated and emailed to you.'
        : 'Your exit documents have been generated.',
      entityType: 'exit_request',
      entityId: requestId,
      redirectUrl: `/admin/exit-management/${requestId}`
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
    `SELECT t.id, t.exit_request_id, t.stage_id, t.title, t.status, t.created_at, t.completed_at, t.due_at,
            t.delay_reason, t.delay_reason_at, t.delay_reason_by,
            CASE
              WHEN t.status = 'COMPLETED' THEN 'COMPLETED'
              WHEN t.status = 'CLOSED' THEN 'CLOSED'
              WHEN t.due_at IS NULL THEN 'PENDING'
              WHEN t.due_at < NOW() THEN 'OVERDUE'
              WHEN t.due_at < NOW() + INTERVAL '2 days' THEN 'DUE_SOON'
              ELSE 'PENDING'
            END AS task_state,
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
    `SELECT t.id, t.stage_id, t.title, t.status, t.assigned_to, t.created_at, t.completed_at, t.due_at,
            t.delay_reason, t.delay_reason_at, t.delay_reason_by,
            CASE
              WHEN t.status = 'COMPLETED' THEN 'COMPLETED'
              WHEN t.status = 'CLOSED' THEN 'CLOSED'
              WHEN t.due_at IS NULL THEN 'PENDING'
              WHEN t.due_at < NOW() THEN 'OVERDUE'
              WHEN t.due_at < NOW() + INTERVAL '2 days' THEN 'DUE_SOON'
              ELSE 'PENDING'
            END AS task_state,
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
  const { rows } = await pool.query(
    `SELECT t.*, er.employee_id, e.full_name, e.work_email, s.name AS stage_name
     FROM exit_tasks t
     JOIN exit_requests er ON er.id = t.exit_request_id
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN exit_workflow_stages s ON s.id = t.stage_id
     WHERE t.id = $1`,
    [taskId],
  );
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
  const completed = upd[0];
  if (completed) {
    const desc = completed.description || '';
    const match = desc.match(/Checklist item ID:\s*(\d+)/i);
    if (match) {
      const itemId = parseInt(match[1], 10);
      await pool.query(
        `UPDATE exit_request_checklist_items SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
        [itemId]
      );
    }
    onTaskCompleted(tenant, task).catch((e) => logger.error('[exit] workflow event error', { err: e.message }));
  }
  return completed;
}

async function onTaskCompleted(tenant, task) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const company = await getCompany(tenant);
    const empName = task.full_name || 'Employee';
    const title = `Exit task completed: ${task.title}`;

    if (task.stage_id) {
      const { recipients } = await resolveResponsibles(tenant, task.stage_id, task.exit_request_id);
      for (const r of recipients) {
        await pushSafe(tenant, { priority: 'NORMAL',
          employeeId: r.employee_id,
          title,
          message: `Task "${task.title}" for ${empName} has been completed.`,
          entityType: 'exit_request',
          entityId: task.exit_request_id,
          redirectUrl: `/admin/exit-management/${task.exit_request_id}`,
        }, {
          notificationType: 'exit.task_completed.owner',
          entityType: 'exit_task',
          entityId: task.id,
          recipientId: r.employee_id,
        });
        if (r.work_email) {
          await emailSafe(tenant, r.work_email, 'exit_task_completed', {
            recipient_name: r.full_name || 'Colleague',
            employee_name: empName,
            task_title: task.title,
            company_name: company.companyName,
          }, {
            notificationType: 'exit.task_completed.owner.email',
            entityType: 'exit_task',
            entityId: task.id,
            recipientId: r.employee_id,
          });
        }
      }
    }

    if (task.employee_id) {
      await pushSafe(tenant, { priority: 'NORMAL',
        employeeId: task.employee_id,
        title,
        message: `A task in your exit process ("${task.title}") has been completed.`,
        entityType: 'exit_request',
        entityId: task.exit_request_id,
        redirectUrl: `/admin/exit-management/${task.exit_request_id}`,
      }, {
        notificationType: 'exit.task_completed.employee',
        entityType: 'exit_task',
        entityId: task.id,
        recipientId: task.employee_id,
      });
      if (task.work_email) {
        await emailSafe(tenant, task.work_email, 'exit_task_completed', {
          recipient_name: empName,
          employee_name: empName,
          task_title: task.title,
          company_name: company.companyName,
        }, {
          notificationType: 'exit.task_completed.employee.email',
          entityType: 'exit_task',
          entityId: task.id,
          recipientId: task.employee_id,
        });
      }
    }

    await workflowAudit.log(tenant, {
      module: 'exit',
      action: 'task_completed',
      entityType: 'exit_task',
      entityId: task.id,
      detail: { title: task.title, exitRequestId: task.exit_request_id },
    });
  } catch (_) { /* non-blocking */ }
}

async function setTaskDelayReason(tenant, taskId, exitUser, reason) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(`SELECT * FROM exit_tasks WHERE id = $1`, [taskId]);
  const task = rows[0];
  const ApiError = require('../../utils/ApiError');
  if (!task) throw ApiError.notFound('Task not found');
  if (task.status !== 'PENDING') {
    throw ApiError.badRequest('Delay reason can be added only for pending tasks');
  }
  const text = String(reason || '').trim();
  if (!text) throw ApiError.badRequest('Delay reason is required');
  const isOwner = exitUser.employeeId && Number(task.assigned_to) === Number(exitUser.employeeId);
  if (!isOwner && !exitUser.isOrgExitAdmin) {
    throw ApiError.forbidden('You can only add delay reason for tasks assigned to you');
  }
  const { rows: upd } = await pool.query(
    `UPDATE exit_tasks
     SET delay_reason = $2, delay_reason_at = NOW(), delay_reason_by = $3
     WHERE id = $1
     RETURNING *`,
    [taskId, text, exitUser.employeeId || null],
  );
  return upd[0];
}

module.exports = {
  onSubmitted,
  onApproved,
  onCompleted,
  onRejected,
  onWithdrawn,
  onSendBack,
  onCommentAdded,
  onStageEntered,
  onReassigned,
  onEscalated,
  onDocumentsSent,
  onTaskCompleted,
  listMyTasks,
  listRequestTasks,
  completeTask,
  setTaskDelayReason,
};
