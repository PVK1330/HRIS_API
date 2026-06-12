'use strict';

/**
 * Integration tests for messaging identity resolution (messagingIdentity.js),
 * locking the fixes: (1) resolve is READ-ONLY — it must NOT create an employee row
 * on a read/socket-connect path; (2) provisioning is race-safe + idempotent; plus
 * the pure participant/parse helpers.
 *
 * DB-backed parts target DEPT_TEST_TENANT_DB (default hris_demo_corp_7) and create
 * only a throwaway '__ITEST__' employee, removed in after(). Pure-function tests
 * always run. SKIPS DB parts if no DB/tenant is reachable.
 *
 * Run: npm run test:messaging
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const {
  resolveMessagingEmployeeId,
  provisionMessagingEmployeeId,
  parseConversationId,
  isConversationParticipant,
  otherParticipantId,
} = require('../modules/messages/messagingIdentity');

const TENANT_DB = process.env.DEPT_TEST_TENANT_DB || 'hris_demo_corp_7';
const MARK = '__ITEST__';
const FAKE_EMAIL = '__itest__msg_identity@example.test';

let ready = false;
let pool = null;

async function cleanup() {
  if (!pool) return;
  await pool
    .query(`DELETE FROM employees WHERE full_name LIKE $1 OR LOWER(work_email) = LOWER($2)`, [`${MARK}%`, FAKE_EMAIL])
    .catch(() => {});
}

test.before(async () => {
  try {
    await db.assertDbConnection();
    pool = await db.getTenantPool(TENANT_DB);
    await cleanup();
    ready = true;
  } catch (_) {
    ready = false;
  }
});

test.after(async () => {
  try { await cleanup(); } catch (_) { /* */ }
  try { await db.closeAllTenantPools(); } catch (_) { /* */ }
  try { await db.pool.end(); } catch (_) { /* */ }
});

test('pure helpers: parseConversationId / participant checks', () => {
  assert.equal(parseConversationId('12'), 12);
  assert.equal(parseConversationId('0'), null);
  assert.equal(parseConversationId('-3'), null);
  assert.equal(parseConversationId('abc'), null);

  const participants = { participant_a: 5, participant_b: 9 };
  assert.equal(isConversationParticipant(participants, 5), true);
  assert.equal(isConversationParticipant(participants, 9), true);
  assert.equal(isConversationParticipant(participants, 7), false);
  assert.equal(isConversationParticipant(null, 5), false);
  assert.equal(isConversationParticipant(participants, null), false);

  assert.equal(otherParticipantId(participants, 5), 9);
  assert.equal(otherParticipantId(participants, 9), 5);
});

test('resolve is READ-ONLY: unknown admin yields null and creates NO employee row', async (t) => {
  if (!ready) { t.skip(`No tenant DB (tenant=${TENANT_DB})`); return; }

  const beforeCount = (await pool.query('SELECT COUNT(*)::int AS c FROM employees')).rows[0].c;
  const user = { role: 'admin', id: 999999001, email: FAKE_EMAIL, name: `${MARK} MsgUser` };

  const resolved = await resolveMessagingEmployeeId(pool, user);
  assert.equal(resolved, null, 'unknown admin resolves to null (no match)');

  const afterCount = (await pool.query('SELECT COUNT(*)::int AS c FROM employees')).rows[0].c;
  assert.equal(afterCount, beforeCount, 'resolve must NOT insert an employee row (read-only)');

  const stillNone = await pool.query('SELECT id FROM employees WHERE LOWER(work_email) = LOWER($1)', [FAKE_EMAIL]);
  assert.equal(stillNone.rows.length, 0, 'no row created for the fake email');
});

test('provisioning creates the identity once and is idempotent', async (t) => {
  if (!ready) { t.skip(`No tenant DB (tenant=${TENANT_DB})`); return; }

  const user = { role: 'admin', id: 999999001, email: FAKE_EMAIL, name: `${MARK} MsgUser` };

  const id1 = await provisionMessagingEmployeeId(pool, user);
  assert.ok(Number.isInteger(id1) && id1 > 0, 'provisioning returns a real employee id');

  const rows = await pool.query('SELECT COUNT(*)::int AS c FROM employees WHERE LOWER(work_email) = LOWER($1)', [FAKE_EMAIL]);
  assert.equal(rows.rows[0].c, 1, 'exactly one row created');

  // Idempotent: a second call (e.g. a concurrent connect) must return the SAME id,
  // not create a duplicate (ON CONFLICT (work_email) DO NOTHING + re-select).
  const id2 = await provisionMessagingEmployeeId(pool, user);
  assert.equal(id2, id1, 'second provision returns the same id');
  const rows2 = await pool.query('SELECT COUNT(*)::int AS c FROM employees WHERE LOWER(work_email) = LOWER($1)', [FAKE_EMAIL]);
  assert.equal(rows2.rows[0].c, 1, 'still exactly one row (no duplicate)');

  // And resolve now finds it (read-only) without creating anything further.
  const resolved = await resolveMessagingEmployeeId(pool, user);
  assert.equal(resolved, id1, 'resolve now returns the provisioned id');
});
