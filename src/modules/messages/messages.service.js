'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const { runTenantMigrations } = require('../tenant/tenant.service');
const empRepo = require('../employees/employees.repository');
const repo = require('./messages.repository');

const _cache = new Map();
async function ensureMigrated(dbName) {
  if (_cache.has(dbName)) return _cache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _cache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _cache.set(dbName, p);
  return p;
}

function getPool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

// ─── List conversations for the current user ──────────────────────────────────

async function listConversations(user) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  // user.id is the employee record id from the JWT
  return repo.listConversations(pool, user.id);
}

// ─── Open / get conversation with another employee ────────────────────────────

async function openConversation(user, otherEmployeeId) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const other = await empRepo.findById(pool, otherEmployeeId);
  if (!other) throw ApiError.notFound('Employee not found');
  if (other.id === user.id) throw ApiError.badRequest('Cannot message yourself');

  const conv = await repo.getOrCreateConversation(pool, user.id, other.id);
  return { conversation: conv, other };
}

// ─── Get messages in a conversation ──────────────────────────────────────────

async function getMessages(user, conversationId, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const limit = Math.min(100, parseInt(query.limit, 10) || 50);
  const before = query.before ? parseInt(query.before, 10) : undefined;

  const msgs = await repo.getMessages(pool, conversationId, { limit, before });

  // Mark messages from the other person as read
  await repo.markRead(pool, conversationId, user.id);

  return { messages: msgs, conversationId };
}

// ─── Send a message (REST fallback — socket is primary) ──────────────────────

async function sendMessage(user, conversationId, body) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  if (!body || !body.trim()) throw ApiError.badRequest('Message body is required');

  const msg = await repo.insertMessage(pool, {
    conversationId,
    senderId: user.id,
    body: body.trim(),
  });
  return msg;
}

// ─── Unread count ─────────────────────────────────────────────────────────────

async function getUnreadCount(user) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  return repo.getUnreadCount(pool, user.id);
}

module.exports = {
  listConversations,
  openConversation,
  getMessages,
  sendMessage,
  getUnreadCount,
};
