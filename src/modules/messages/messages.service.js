'use strict';

const path = require('path');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { ensureMigrated } = require('../../utils/tenantMigration');
const empRepo = require('../employees/employees.repository');
const repo = require('./messages.repository');
const { inferMessageType } = require('./messages.upload');
const {
  ensureMessagingEmployeeId,
  provisionMessagingEmployeeId,
  parseConversationId,
  isConversationParticipant,
  otherParticipantId,
} = require('./messagingIdentity');

function getPool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

// Resolve the messaging context. provision:false (default) is READ-ONLY — it never
// writes, so reads and the socket-connect path can't auto-create employee rows.
// provision:true is used only by deliberate write actions (open conversation /
// send), which race-safely create the identity if the caller lacks one.
async function getMessagingContext(user, { provision = false } = {}) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const employeeId = provision
    ? await provisionMessagingEmployeeId(pool, user)
    : await ensureMessagingEmployeeId(pool, user);
  return { pool, employeeId }; // employeeId may be null (caller decides)
}

async function requireMessagingEmployeeId(user, opts = {}) {
  const { pool, employeeId } = await getMessagingContext(user, opts);
  if (!employeeId) {
    throw ApiError.badRequest(
      'Could not link your account to an employee profile for messaging. Please log out and sign in again.',
    );
  }
  return { pool, employeeId };
}

function formatMessagePayload(msg) {
  return {
    id: msg.id,
    conversation_id: msg.conversation_id,
    sender_id: msg.sender_id,
    body: msg.body,
    created_at: msg.created_at,
    is_read: msg.is_read,
    message_type: msg.message_type || 'text',
    attachment_url: msg.attachment_url || null,
    attachment_name: msg.attachment_name || null,
    attachment_mime: msg.attachment_mime || null,
    attachment_size: msg.attachment_size ?? null,
  };
}

function emitMessageRealtime(conversationId, participants, employeeId, msg, clientId = null) {
  try {
    const { getIo } = require('../../socket');
    const io = getIo();
    if (!io) return;

    // Echo the sender's stable client temp id so their originating tab can drop the
    // matching optimistic placeholder by id (harmless null for the other party).
    const payload = { ...formatMessagePayload(msg), client_id: clientId ?? null };
    const preview = payload.body || (payload.attachment_name ? `📎 ${payload.attachment_name}` : 'Attachment');
    const otherId = otherParticipantId(participants, employeeId);

    io.to(`conv:${conversationId}`).emit('new_message', payload);
    io.to(`user:${otherId}`).emit('conversation:updated', {
      conversationId,
      lastMessage: preview,
      lastMessageAt: msg.created_at,
      message: payload,
    });
    io.to(`user:${employeeId}`).emit('conversation:updated', {
      conversationId,
      lastMessage: preview,
      lastMessageAt: msg.created_at,
      message: payload,
    });
  } catch {
    /* non-critical */
  }
}

async function listConversations(user) {
  // Page-load read: tolerate a not-yet-provisioned identity (e.g. an admin who
  // hasn't started a chat). Their identity is created on the first openConversation.
  const { pool, employeeId } = await getMessagingContext(user);
  if (!employeeId) return [];
  return repo.listConversations(pool, employeeId);
}

async function listContacts(user, query = {}) {
  const { pool, employeeId } = await getMessagingContext(user);
  const limit = query.limit != null ? parseInt(query.limit, 10) : 10000;
  return repo.listMessageContacts(pool, employeeId, {
    search: query.search || '',
    limit: Number.isInteger(limit) && limit > 0 ? limit : 10000,
  });
}

async function openConversation(user, otherEmployeeId) {
  // Deliberate authenticated action → create the caller's messaging identity if
  // they don't have one yet (race-safe). This is the proper provisioning flow,
  // replacing the old side-effectful auto-provision on the read/socket path.
  const { pool, employeeId } = await requireMessagingEmployeeId(user, { provision: true });
  const otherId = parseInt(otherEmployeeId, 10);
  if (!Number.isInteger(otherId) || otherId <= 0) {
    throw ApiError.badRequest('Invalid employee id');
  }

  const other = await empRepo.findById(pool, otherId);
  if (!other) throw ApiError.notFound('Employee not found');
  if (Number(other.id) === employeeId) throw ApiError.badRequest('Cannot message yourself');

  const conv = await repo.getOrCreateConversation(pool, employeeId, other.id);
  return { conversation: conv, other };
}

async function getMessages(user, conversationIdRaw, query = {}) {
  const conversationId = parseConversationId(conversationIdRaw);
  if (!conversationId) throw ApiError.badRequest('Invalid conversation id');

  const { pool, employeeId } = await requireMessagingEmployeeId(user);
  const participants = await repo.getConversationParticipants(pool, conversationId);
  if (!participants) throw ApiError.notFound('Conversation not found');
  if (!isConversationParticipant(participants, employeeId)) {
    throw ApiError.forbidden('Not a participant in this conversation');
  }

  const limit = Math.min(100, parseInt(query.limit, 10) || 50);
  const before = query.before ? parseInt(query.before, 10) : undefined;

  const msgs = await repo.getMessages(pool, conversationId, { limit, before });
  await repo.markRead(pool, conversationId, employeeId);

  return { messages: msgs, conversationId };
}

async function sendMessage(user, conversationIdRaw, body, clientId = null) {
  const conversationId = parseConversationId(conversationIdRaw);
  if (!conversationId) throw ApiError.badRequest('Invalid conversation id');

  const { pool, employeeId } = await requireMessagingEmployeeId(user, { provision: true });
  const text = String(body || '').trim();
  if (!text) throw ApiError.badRequest('Message body is required');

  const participants = await repo.getConversationParticipants(pool, conversationId);
  if (!participants) throw ApiError.notFound('Conversation not found');
  if (!isConversationParticipant(participants, employeeId)) {
    throw ApiError.forbidden('Not a participant in this conversation');
  }

  const msg = await repo.insertMessage(pool, {
    conversationId,
    senderId: employeeId,
    body: text,
    messageType: 'text',
  });

  emitMessageRealtime(conversationId, participants, employeeId, msg, clientId);
  return msg;
}

async function sendMessageAttachment(user, conversationIdRaw, file, caption = '') {
  const conversationId = parseConversationId(conversationIdRaw);
  if (!conversationId) throw ApiError.badRequest('Invalid conversation id');
  if (!file) throw ApiError.badRequest('No file uploaded');

  const { pool, employeeId } = await requireMessagingEmployeeId(user, { provision: true });
  const participants = await repo.getConversationParticipants(pool, conversationId);
  if (!participants) throw ApiError.notFound('Conversation not found');
  if (!isConversationParticipant(participants, employeeId)) {
    throw ApiError.forbidden('Not a participant in this conversation');
  }

  const tenantDb = user.db_name || 'default';
  const relativeUrl = `/uploads/messages/${tenantDb}/${path.basename(file.filename)}`;
  const messageType = inferMessageType(file.mimetype);
  const text = String(caption || '').trim() || (messageType === 'image' ? '' : `📎 ${file.originalname}`);

  const msg = await repo.insertMessage(pool, {
    conversationId,
    senderId: employeeId,
    body: text,
    messageType,
    attachmentUrl: relativeUrl,
    attachmentName: file.originalname,
    attachmentMime: file.mimetype,
    attachmentSize: file.size,
  });

  emitMessageRealtime(conversationId, participants, employeeId, msg);
  return msg;
}

async function getUnreadCount(user) {
  // Page-load read — no identity yet means no unread messages.
  const { pool, employeeId } = await getMessagingContext(user);
  if (!employeeId) return 0;
  return repo.getUnreadCount(pool, employeeId);
}

module.exports = {
  listConversations,
  listContacts,
  openConversation,
  getMessages,
  sendMessage,
  sendMessageAttachment,
  getUnreadCount,
  ensureMessagingEmployeeId,
  parseConversationId,
  isConversationParticipant,
  otherParticipantId,
  emitMessageRealtime,
  formatMessagePayload,
};
