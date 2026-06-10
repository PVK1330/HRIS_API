'use strict';

const logger = require('../../utils/logger');
const empRepo = require('../employees/employees.repository');

function isPortalEmployee(user) {
  return user?.role === 'employee' || user?.userType === 'employee';
}

function isTenantWorkspaceUser(user) {
  return user?.role === 'admin' || isPortalEmployee(user);
}

async function employeeExists(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [employeeId],
  );
  return !!rows[0];
}

async function findEmployeeByLogin(pool, loginId) {
  const key = String(loginId || '').trim().toLowerCase();
  if (!key) return null;

  const { rows } = await pool.query(
    `SELECT id FROM employees
     WHERE deleted_at IS NULL
       AND (
         LOWER(work_email) = $1
         OR LOWER(username) = $1
         OR LOWER(COALESCE(personal_email, '')) = $1
       )
     LIMIT 1`,
    [key],
  );
  const id = rows[0]?.id != null ? Number(rows[0].id) : null;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Create the messaging employee row for a tenant-workspace user that doesn't have
 * one yet (typically an org admin whose login lives in admin_users, not employees).
 *
 * RACE-SAFE: two concurrent connects/actions for the same admin could both try to
 * provision. work_email is UNIQUE on employees, so `ON CONFLICT (work_email) DO
 * NOTHING` makes the loser's INSERT a harmless no-op; we then re-select the row the
 * winner created. This is the ONLY place that writes — it must be called from a
 * deliberate, authenticated action (see provisionMessagingEmployeeId), NEVER from a
 * read/socket-connect path.
 */
async function provisionEmployeeRow(pool, user) {
  const email = String(user.email || '').trim();
  if (!email) return null;

  const existing = await findEmployeeByLogin(pool, email);
  if (existing) return existing;

  try {
    const { rows: roleRows } = await pool.query(
      `SELECT id FROM rbac_roles WHERE is_system = true ORDER BY id LIMIT 1`,
    );
    const roleId = roleRows[0]?.id || null;
    const name = user.name || email.split('@')[0] || 'User';
    const username = email.includes('@') ? email.split('@')[0] : email;
    const empId = await empRepo.getNextEmpId(pool);

    const { rows: newEmp } = await pool.query(
      `INSERT INTO employees (
         emp_id, full_name, work_email, username, portal_enabled, rbac_role_id,
         employment_status, job_title, department, employment_type, join_date
       ) VALUES ($1, $2, $3, $4, true, $5, 'Active', $6, $7, $8, CURRENT_DATE)
       ON CONFLICT (work_email) DO NOTHING
       RETURNING id`,
      [
        empId,
        name,
        email,
        username,
        roleId,
        user.role === 'admin' ? 'Organization Admin' : 'Employee',
        'General',
        'Full-time',
      ],
    );
    const id = Number(newEmp[0]?.id);
    if (Number.isInteger(id) && id > 0) {
      logger.info(`[messages] provisioned messaging employee ${id} for ${email}`);
      return id;
    }
  } catch (err) {
    // emp_id race or any other write error — fall through to the re-select below.
    logger.error(`[messages] provision failed for ${email}:`, err.message);
  }

  // ON CONFLICT no-op (another connect won the race) or a write error → return
  // whichever row now exists.
  return findEmployeeByLogin(pool, email);
}

/**
 * Resolve the employees.id used for messaging (never admin_users.id).
 * READ-ONLY: this is what the socket-connect/presence and all read paths call, so
 * it must have NO side effects. Returns null if the user has no employee profile;
 * provisioning happens only via provisionMessagingEmployeeId on a write action.
 */
async function resolveMessagingEmployeeId(pool, user) {
  if (!user || !pool) return null;

  const candidates = [
    user.employeeId != null ? Number(user.employeeId) : null,
    isPortalEmployee(user) ? Number(user.id) : null,
  ].filter((id) => Number.isInteger(id) && id > 0);

  for (const id of candidates) {
    if (await employeeExists(pool, id)) return id;
  }

  if (user.email) {
    const byLogin = await findEmployeeByLogin(pool, user.email);
    if (byLogin) return byLogin;
  }

  return null;
}

// READ-ONLY alias used by the socket connect path and pure reads.
async function ensureMessagingEmployeeId(pool, user) {
  return resolveMessagingEmployeeId(pool, user);
}

/**
 * Resolve the messaging identity, CREATING it (race-safe) if missing. Call this
 * ONLY from deliberate authenticated write actions (open conversation / send),
 * never from reads — that's what keeps provisioning off the socket/read path.
 */
async function provisionMessagingEmployeeId(pool, user) {
  if (!user || !pool) return null;
  const existing = await resolveMessagingEmployeeId(pool, user);
  if (existing) return existing;
  if (isTenantWorkspaceUser(user)) return provisionEmployeeRow(pool, user);
  return null;
}

function parseConversationId(value) {
  const id = parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isConversationParticipant(participants, employeeId) {
  if (!participants || employeeId == null) return false;
  const id = Number(employeeId);
  return (
    Number(participants.participant_a) === id
    || Number(participants.participant_b) === id
  );
}

function otherParticipantId(participants, employeeId) {
  const id = Number(employeeId);
  return Number(participants.participant_a) === id
    ? Number(participants.participant_b)
    : Number(participants.participant_a);
}

module.exports = {
  resolveMessagingEmployeeId,
  ensureMessagingEmployeeId,
  provisionMessagingEmployeeId,
  parseConversationId,
  isConversationParticipant,
  otherParticipantId,
};
