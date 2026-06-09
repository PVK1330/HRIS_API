'use strict';

/**
 * Integration test for the policy acknowledgement lifecycle (P1/P2) + soft delete
 * (P6) + archived-tracking access + audit (P5) + reminder scheduling/cron (P3),
 * exercised through the real service/repository against a tenant database.
 *
 * DB-backed: targets POLICY_TEST_TENANT_DB (default hris_demo_corp_7) and the first
 * employee-with-department as a one-person audience to keep blast radius minimal.
 * Throwaway '__ITEST__' policies (+ their notifications/audit/reminders) are removed
 * in after(). SKIPS (not fails) if no DB/tenant/employee is reachable.
 *
 * Run: npm run test:policies
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const service = require('../modules/policies/policies.service');
const { runPolicyAckReminders, runPolicyReviewReminders } = require('../jobs/policyAckReminder.job');

const TENANT_DB = process.env.POLICY_TEST_TENANT_DB || 'hris_demo_corp_7';
const tenant = { dbName: TENANT_DB };
const DAY = 24 * 60 * 60 * 1000;

let ready = false;
let pool = null;
let emp = null;

test.before(async () => {
  try {
    await db.assertDbConnection();
    pool = await db.getTenantPool(TENANT_DB);
    const { rows } = await pool.query(
      "SELECT id, department_id FROM employees WHERE deleted_at IS NULL AND department_id IS NOT NULL ORDER BY id LIMIT 1",
    );
    if (rows[0]) { emp = rows[0]; ready = true; }
  } catch (_) {
    ready = false;
  }
});

test.after(async () => {
  try {
    if (pool) {
      const { rows } = await pool.query("SELECT id FROM policies WHERE title LIKE '__ITEST__%'");
      for (const { id } of rows) {
        await pool.query("DELETE FROM notifications WHERE entity_type='policy' AND entity_id=$1", [id]);
        await pool.query("DELETE FROM workflow_audit_logs WHERE entity_type='policy' AND entity_id=$1", [id]);
        await pool.query('DELETE FROM policies WHERE id=$1', [id]); // cascades acks + reminders
      }
    }
  } catch (_) { /* best-effort */ }
  try { await db.closeAllTenantPools(); } catch (_) { /* */ }
  try { await db.pool.end(); } catch (_) { /* */ }
});

const countNotifs = async (pid) =>
  (await pool.query("SELECT count(*)::int c FROM notifications WHERE entity_type='policy' AND entity_id=$1", [pid])).rows[0].c;
const countReminders = async (pid) =>
  (await pool.query("SELECT count(*)::int c FROM notifications WHERE entity_type='policy' AND entity_id=$1 AND title LIKE 'Reminder:%'", [pid])).rows[0].c;
const reminderRowCount = async (pid, eid) =>
  (await pool.query('SELECT count(*)::int c FROM policy_ack_reminders WHERE policy_id=$1 AND employee_id=$2', [pid, eid])).rows[0].c;

test('lifecycle + soft delete + archived tracking + audit', async (t) => {
  if (!ready) { t.skip(`No tenant DB/employee (tenant=${TENANT_DB})`); return; }
  const empId = Number(emp.id);
  const deptId = Number(emp.department_id);
  const EMP = { role: 'employee', id: empId };
  const ADMIN = { id: empId, name: 'ITEST Admin' };
  const trackStatus = async (pid) =>
    (await service.getCompliance(tenant, pid)).find((r) => Number(r.employee_id) === empId)?.status;

  const created = await service.createPolicy(tenant, ADMIN, {
    title: '__ITEST__ lifecycle', category: 'General', status: 'Published', ackRequired: true,
    sections: { introduction: 'v1 body' }, audienceConfig: { type: 'departments', departmentIds: [deptId] },
  });
  const pid = created.id;
  assert.equal(Number(created.contentVersion), 1, 'create → content_version 1');
  assert.ok(created.content_hash, 'create → content_hash set');
  assert.equal(await countNotifs(pid), 1, 'publish → exactly one notification (no double-notify)');
  assert.equal(await reminderRowCount(pid, empId), 1, 'publish → reminder scheduling row enrolled');

  await service.acknowledgePolicy(tenant, EMP, pid);
  assert.equal(
    Number((await pool.query('SELECT acknowledged_version FROM policy_acknowledgements WHERE policy_id=$1 AND employee_id=$2', [pid, empId])).rows[0].acknowledged_version),
    1, 'acknowledge → version 1',
  );
  assert.equal((await service.getMyPolicy(tenant, EMP, pid)).ackStatus, 'Acknowledged', 'My Policies → Acknowledged');
  assert.equal(await reminderRowCount(pid, empId), 0, 'acknowledge → reminder row cleared');

  await service.updatePolicy(tenant, pid, { sections: { introduction: 'v2 body CHANGED' } }, ADMIN);
  assert.equal(Number((await service.getPolicy(tenant, pid)).contentVersion), 2, 'edit body → content_version 2');
  assert.equal(await countNotifs(pid), 2, 'version bump → re-notified once');
  assert.equal(await reminderRowCount(pid, empId), 1, 'version bump → reminder row re-enrolled');
  const mine = await service.getMyPolicy(tenant, EMP, pid);
  assert.equal(mine.ackStatus, 'Pending', 'Pending after bump');
  assert.equal(mine.needsReacknowledgement, true, 'needsReacknowledgement flag set');
  assert.equal(await trackStatus(pid), 'Pending', 'tracking Pending after bump');

  await service.acknowledgePolicy(tenant, EMP, pid);
  assert.equal(
    Number((await pool.query('SELECT acknowledged_version FROM policy_acknowledgements WHERE policy_id=$1 AND employee_id=$2', [pid, empId])).rows[0].acknowledged_version),
    2, 're-acknowledge → version 2',
  );
  assert.equal(await trackStatus(pid), 'Acknowledged', 'tracking Acknowledged (v2)');

  const noop = await countNotifs(pid);
  await service.updatePolicy(tenant, pid, { sections: { introduction: 'v2 body CHANGED' } }, ADMIN);
  assert.equal(Number((await service.getPolicy(tenant, pid)).contentVersion), 2, 'no-op re-save → version stays 2');
  assert.equal(await countNotifs(pid), noop, 'no-op re-save → no new notification');

  // P6 soft delete + archived-tracking access
  const ackBefore = (await pool.query('SELECT count(*)::int c FROM policy_acknowledgements WHERE policy_id=$1', [pid])).rows[0].c;
  await service.deletePolicy(tenant, pid, ADMIN);
  assert.ok((await pool.query('SELECT archived_at FROM policies WHERE id=$1', [pid])).rows[0].archived_at, 'soft delete → archived_at set');
  assert.equal((await pool.query('SELECT count(*)::int c FROM policy_acknowledgements WHERE policy_id=$1', [pid])).rows[0].c, ackBefore, 'archive retains ack history');
  assert.ok(!(await service.listPolicies(tenant, {})).some((p) => Number(p.id) === pid), 'archived hidden from admin list');
  assert.ok(!(await service.listMyPolicies(tenant, EMP)).some((p) => Number(p.id) === pid), 'archived hidden from My Policies');
  await assert.rejects(() => service.getPolicy(tenant, pid), /not found/i, 'archived → get 404');
  // closes the P6 loop: history reachable after archive
  assert.ok((await service.listArchivedPolicies(tenant)).some((p) => Number(p.id) === pid), 'archived policy appears in archived list');
  const archTrack = (await service.getArchivedCompliance(tenant, pid)).find((r) => Number(r.employee_id) === empId);
  assert.equal(archTrack?.status, 'Acknowledged', 'archived tracking still shows the retained acknowledgement');

  const actions = (await pool.query("SELECT action FROM workflow_audit_logs WHERE entity_type='policy' AND entity_id=$1", [pid])).rows.map((r) => r.action);
  for (const a of ['create', 'acknowledge', 'update', 'version_bump', 'archive']) {
    assert.ok(actions.includes(a), `audit logged action: ${a}`);
  }
});

test('reminder cron: threshold gate, cadence cap, ack stops reminders', async (t) => {
  if (!ready) { t.skip(`No tenant DB/employee (tenant=${TENANT_DB})`); return; }
  const empId = Number(emp.id);
  const deptId = Number(emp.department_id);
  const EMP = { role: 'employee', id: empId };
  const ADMIN = { id: empId, name: 'ITEST Admin' };

  const created = await service.createPolicy(tenant, ADMIN, {
    title: '__ITEST__ reminder', category: 'General', status: 'Published', ackRequired: true,
    sections: { introduction: 'please ack' }, audienceConfig: { type: 'departments', departmentIds: [deptId] },
  });
  const pid = created.id;
  assert.equal(await reminderRowCount(pid, empId), 1, 'publish enrolled the reminder row');

  // Fresh row (first_pending_at = now) → NOT due under a large threshold.
  await runPolicyAckReminders({ dbNames: [TENANT_DB], policyIds: [pid], thresholdMs: 365 * DAY, cadenceMs: 0 });
  assert.equal(await countReminders(pid), 0, 'not reminded before threshold');

  // Backdate the pending episode so it is now overdue.
  await pool.query("UPDATE policy_ack_reminders SET first_pending_at = NOW() - INTERVAL '10 days' WHERE policy_id=$1 AND employee_id=$2", [pid, empId]);
  await runPolicyAckReminders({ dbNames: [TENANT_DB], policyIds: [pid], thresholdMs: 3 * DAY, cadenceMs: 3 * DAY });
  assert.equal(await countReminders(pid), 1, 'reminded once after threshold');

  // Cadence cap — immediate re-run must not re-remind.
  await runPolicyAckReminders({ dbNames: [TENANT_DB], policyIds: [pid], thresholdMs: 3 * DAY, cadenceMs: 3 * DAY });
  assert.equal(await countReminders(pid), 1, 'cadence window caps repeat reminders');

  // Acknowledge → row cleared → no further reminders even with zero threshold.
  await service.acknowledgePolicy(tenant, EMP, pid);
  assert.equal(await reminderRowCount(pid, empId), 0, 'ack cleared the reminder row');
  await runPolicyAckReminders({ dbNames: [TENANT_DB], policyIds: [pid], thresholdMs: 0, cadenceMs: 0 });
  assert.equal(await countReminders(pid), 1, 'no reminder after acknowledgement');

  const actions = (await pool.query("SELECT action FROM workflow_audit_logs WHERE entity_type='policy' AND entity_id=$1", [pid])).rows.map((r) => r.action);
  assert.ok(actions.includes('reminder'), 'audit logged the reminder send');
});

test('review-date reminders (P4): overdue notifies admins, cadence caps, review_date change re-arms', async (t) => {
  if (!ready) { t.skip(`No tenant DB/employee (tenant=${TENANT_DB})`); return; }
  const empId = Number(emp.id);
  const deptId = Number(emp.department_id);
  const ADMIN = { id: empId, name: 'ITEST Admin' };
  const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

  const created = await service.createPolicy(tenant, ADMIN, {
    title: '__ITEST__ review', category: 'General', status: 'Published', ackRequired: false,
    reviewDate: isoDaysAgo(10), audienceConfig: { type: 'departments', departmentIds: [deptId] },
  });
  const pid = created.id;
  const reviewNotifs = async () =>
    (await pool.query("SELECT count(*)::int c FROM notifications WHERE entity_type='policy' AND entity_id=$1 AND title LIKE 'Policy review due%'", [pid])).rows[0].c;

  // Overdue → one admin notification.
  await runPolicyReviewReminders({ dbNames: [TENANT_DB], policyIds: [pid], leadDays: 7, cadenceMs: 3 * DAY });
  assert.equal(await reviewNotifs(), 1, 'overdue policy → review reminder to admins');
  assert.ok((await pool.query('SELECT review_reminded_at FROM policies WHERE id=$1', [pid])).rows[0].review_reminded_at, 'review_reminded_at stamped');

  // Cadence cap — immediate re-run does not re-notify.
  await runPolicyReviewReminders({ dbNames: [TENANT_DB], policyIds: [pid], leadDays: 7, cadenceMs: 3 * DAY });
  assert.equal(await reviewNotifs(), 1, 'cadence caps repeat review reminders');

  // Changing review_date re-arms (review_reminded_at reset → reminds again).
  await service.updatePolicy(tenant, pid, { reviewDate: isoDaysAgo(5) }, ADMIN);
  assert.equal((await pool.query('SELECT review_reminded_at FROM policies WHERE id=$1', [pid])).rows[0].review_reminded_at, null, 'changing review_date re-arms reminders');
  await runPolicyReviewReminders({ dbNames: [TENANT_DB], policyIds: [pid], leadDays: 7, cadenceMs: 3 * DAY });
  assert.equal(await reviewNotifs(), 2, 'reminds again after review_date change');

  const actions = (await pool.query("SELECT action FROM workflow_audit_logs WHERE entity_type='policy' AND entity_id=$1", [pid])).rows.map((r) => r.action);
  assert.ok(actions.includes('review_reminder'), 'audit logged the review reminder');
});
