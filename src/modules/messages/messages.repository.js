'use strict';

// ─── Conversations ────────────────────────────────────────────────────────────

/**
 * Get or create a conversation between two employees.
 * Always stores participant_a < participant_b to satisfy the CHECK constraint.
 */
async function getOrCreateConversation(pool, idA, idB) {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const { rows } = await pool.query(
    `INSERT INTO conversations (participant_a, participant_b)
     VALUES ($1, $2)
     ON CONFLICT (participant_a, participant_b) DO UPDATE
       SET participant_a = EXCLUDED.participant_a   -- no-op, just return row
     RETURNING id, participant_a, participant_b, last_message, last_message_at`,
    [a, b]
  );
  return rows[0];
}

/**
 * List all conversations for a given employee, with the other participant's info.
 */
async function listConversations(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT
       c.id,
       c.last_message,
       c.last_message_at,
       -- other participant
       CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END AS other_id,
       e.full_name  AS other_name,
       e.job_title  AS other_role,
       e.emp_id     AS other_emp_id,
       -- unread count for this employee
       (SELECT COUNT(*)::int FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> $1
          AND m.is_read = false) AS unread_count
     FROM conversations c
     JOIN employees e
       ON e.id = CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END
      AND e.deleted_at IS NULL
     WHERE c.participant_a = $1 OR c.participant_b = $1
     ORDER BY c.last_message_at DESC NULLS LAST`,
    [employeeId]
  );
  return rows;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

async function getMessages(pool, conversationId, { limit = 50, before } = {}) {
  const params = [parseInt(conversationId, 10), limit];
  let whereBefore = '';
  if (before) {
    params.push(parseInt(before, 10));
    whereBefore = `AND m.id < $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.is_read,
            TO_CHAR(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
            COALESCE(e.full_name, 'User') AS sender_name
     FROM messages m
     LEFT JOIN employees e ON e.id = m.sender_id AND e.deleted_at IS NULL
     WHERE m.conversation_id = $1 ${whereBefore}
     ORDER BY m.created_at ASC
     LIMIT $2`,
    params
  );
  return rows;
}

async function insertMessage(pool, { conversationId, senderId, body }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, conversation_id, sender_id, body, is_read,
               TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
    [conversationId, senderId, body]
  );
  const msg = rows[0];

  // Update conversation's last_message snapshot
  await pool.query(
    `UPDATE conversations
     SET last_message = $1, last_message_at = $2
     WHERE id = $3`,
    [body.length > 60 ? body.slice(0, 60) + '…' : body, msg.created_at, conversationId]
  );

  return msg;
}

async function markRead(pool, conversationId, readerId) {
  await pool.query(
    `UPDATE messages
     SET is_read = true
     WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = false`,
    [conversationId, readerId]
  );
}

async function getUnreadCount(pool, employeeId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE (c.participant_a = $1 OR c.participant_b = $1)
       AND m.sender_id <> $1
       AND m.is_read = false`,
    [employeeId]
  );
  return rows[0].total;
}

module.exports = {
  getOrCreateConversation,
  listConversations,
  getMessages,
  insertMessage,
  markRead,
  getUnreadCount,
};
