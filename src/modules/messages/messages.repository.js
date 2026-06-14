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
       e.full_name         AS other_name,
       e.job_title         AS other_role,
       e.emp_id            AS other_emp_id,
       e.profile_image_url AS other_profile_image_url,
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
            COALESCE(m.message_type, 'text') AS message_type,
            m.attachment_url, m.attachment_name, m.attachment_mime, m.attachment_size,
            TO_CHAR(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
            COALESCE(e.full_name, 'User') AS sender_name
     FROM messages m
     LEFT JOIN employees e ON e.id = m.sender_id AND e.deleted_at IS NULL
     WHERE m.conversation_id = $1 ${whereBefore}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $2`,
    params
  );
  // Fetched newest-first so the initial load returns the most RECENT N messages,
  // and `before` (m.id < cursor) returns the N immediately BEFORE the cursor —
  // not the oldest page. Reverse to ascending/chronological order (oldest → newest)
  // for display; the frontend appends new messages to the end and scrolls to bottom.
  return rows.reverse();
}

async function insertMessage(pool, {
  conversationId,
  senderId,
  body,
  messageType = 'text',
  attachmentUrl = null,
  attachmentName = null,
  attachmentMime = null,
  attachmentSize = null,
}) {
  const text = String(body || '').trim();
  const { rows } = await pool.query(
    `INSERT INTO messages (
       conversation_id, sender_id, body, message_type,
       attachment_url, attachment_name, attachment_mime, attachment_size
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, conversation_id, sender_id, body, is_read,
               COALESCE(message_type, 'text') AS message_type,
               attachment_url, attachment_name, attachment_mime, attachment_size,
               TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
    [
      conversationId,
      senderId,
      text,
      messageType,
      attachmentUrl,
      attachmentName,
      attachmentMime,
      attachmentSize,
    ],
  );
  const msg = rows[0];

  const preview = text || (attachmentName ? `📎 ${attachmentName}` : 'Attachment');
  await pool.query(
    `UPDATE conversations
     SET last_message = $1, last_message_at = $2
     WHERE id = $3`,
    [preview.length > 60 ? `${preview.slice(0, 60)}…` : preview, msg.created_at, conversationId],
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

async function getConversationParticipants(pool, conversationId) {
  const { rows } = await pool.query(
    `SELECT participant_a, participant_b
     FROM conversations
     WHERE id = $1`,
    [conversationId],
  );
  return rows[0] || null;
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

/** All org employees as message contacts (no HR directory data-scope filter). */
async function listMessageContacts(pool, employeeId, { search = '', limit = 10000 } = {}) {
  const params = [employeeId];
  let searchSql = '';
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const n = params.length;
    searchSql = `AND (
      e.full_name ILIKE $${n}
      OR e.job_title ILIKE $${n}
      OR e.work_email ILIKE $${n}
      OR e.department ILIKE $${n}
      OR e.emp_id ILIKE $${n}
    )`;
  }
  const cap = Math.min(10000, Math.max(1, parseInt(limit, 10) || 10000));
  params.push(cap);

  const { rows } = await pool.query(
    `SELECT e.id, e.full_name, e.job_title, e.work_email, e.profile_image_url,
            e.emp_id, e.department, e.employment_status
     FROM employees e
     WHERE e.deleted_at IS NULL
       AND e.id <> $1
       ${searchSql}
     ORDER BY e.full_name ASC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

module.exports = {
  getOrCreateConversation,
  getConversationParticipants,
  listConversations,
  getMessages,
  insertMessage,
  markRead,
  getUnreadCount,
  listMessageContacts,
};
