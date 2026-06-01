'use strict';

/**
 * Exit dashboard widgets (spec §15) — sourced PURELY from workflow ownership,
 * never from manager_id / reporting hierarchy. Ownership = stage assignment
 * (exit_stage_departments ∪ exit_stage_roles ∪ exit_stage_users) matched to the
 * caller's own department_id / rbac_role_id / employee_id, or isOrgExitAdmin.
 */

const { getTenantPool } = require('../../config/db');

async function getDashboardWidgets(tenant, exitUser) {
  const pool = await getTenantPool(tenant.dbName);
  const empId = exitUser.employeeId || null;
  const deptId = exitUser.departmentId || null;
  const roleId = exitUser.rbacRoleId || null;
  const admin = Boolean(exitUser.isOrgExitAdmin);

  // ownership predicate over the current stage
  const ownsCurrent = `(
    $4 = true
    OR EXISTS (SELECT 1 FROM exit_stage_departments sd WHERE sd.stage_id = er.current_stage_id AND sd.department_id = $2)
    OR EXISTS (SELECT 1 FROM exit_stage_roles sr WHERE sr.stage_id = er.current_stage_id AND sr.role_id = $3)
    OR EXISTS (SELECT 1 FROM exit_stage_users su WHERE su.stage_id = er.current_stage_id AND su.employee_id = $1)
  )`;
  // participation predicate (terminal action on any stage) for closed requests
  const participated = `(
    $4 = true
    OR EXISTS (SELECT 1 FROM exit_approvals ea WHERE ea.exit_request_id = er.id AND ea.actor_id = $1
               AND ea.action IN ('APPROVE','REJECT','SEND_BACK','COMPLETE'))
    OR EXISTS (SELECT 1 FROM exit_approvals ed JOIN exit_stage_departments sdd ON sdd.stage_id = ed.stage_id
               WHERE ed.exit_request_id = er.id AND sdd.department_id = $2)
    OR EXISTS (SELECT 1 FROM exit_approvals er2 JOIN exit_stage_roles srr ON srr.stage_id = er2.stage_id
               WHERE er2.exit_request_id = er.id AND srr.role_id = $3)
  )`;
  const params = [empId, deptId, roleId, admin];

  const q = (sql) => pool.query(sql, params).then((r) => r.rows);

  const [pendingMine, inMyDept, slaBreaches, completed, rejected, withdrawn] = await Promise.all([
    // 1. Pending My Approvals — I own the current stage and have NOT approved it yet
    q(`SELECT er.id FROM exit_requests er
       WHERE er.status = 'IN_PROGRESS' AND ${ownsCurrent}
         AND NOT EXISTS (SELECT 1 FROM exit_approvals a
                         WHERE a.exit_request_id = er.id AND a.stage_id = er.current_stage_id
                           AND a.actor_id = $1 AND a.action = 'APPROVE')`),
    // 2. Exits In My Department Stages
    q(`SELECT er.id FROM exit_requests er
       WHERE er.status = 'IN_PROGRESS'
         AND ($4 = true OR er.current_owner_department_id = $2 OR ${ownsCurrent})`),
    // 3. SLA Breaches — current stage active past its SLA, owned by me
    q(`SELECT er.id FROM exit_requests er
       JOIN exit_workflow_stages s ON s.id = er.current_stage_id
       WHERE er.status = 'IN_PROGRESS' AND s.sla_hours IS NOT NULL
         AND (er.stage_entered_at + (s.sla_hours || ' hours')::interval) < NOW()
         AND ${ownsCurrent}`),
    // 4/5/6 closed states + participation
    q(`SELECT er.id FROM exit_requests er WHERE er.status = 'COMPLETED' AND ${participated}`),
    q(`SELECT er.id FROM exit_requests er WHERE er.status = 'REJECTED' AND ${participated}`),
    q(`SELECT er.id FROM exit_requests er WHERE er.status = 'WITHDRAWN' AND ${participated}`),
  ]);

  const widget = (rows) => ({ count: rows.length, ids: rows.map((r) => Number(r.id)) });
  return {
    pending_my_approvals: widget(pendingMine),
    exits_in_my_department_stages: widget(inMyDept),
    sla_breaches: widget(slaBreaches),
    completed_exits: widget(completed),
    rejected_exits: widget(rejected),
    withdrawn_requests: widget(withdrawn),
  };
}

module.exports = { getDashboardWidgets };
