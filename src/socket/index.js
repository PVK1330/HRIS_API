'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { socketCorsOrigin } = require('../config/cors');
const { getTenantPool } = require('../config/db');
const logger = require('../utils/logger');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const repo = require('../modules/messages/messages.repository');
const {
  ensureMessagingEmployeeId,
  parseConversationId,
  isConversationParticipant,
} = require('../modules/messages/messagingIdentity');
const { emitMessageRealtime, formatMessagePayload } = require('../modules/messages/messages.service');

const onlineUsers = new Map();

function addOnline(employeeId, socketId) {
  const key = Number(employeeId);
  if (!onlineUsers.has(key)) onlineUsers.set(key, new Set());
  onlineUsers.get(key).add(socketId);
}

function removeOnline(employeeId, socketId) {
  const key = Number(employeeId);
  const sockets = onlineUsers.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) onlineUsers.delete(key);
}

function isOnline(employeeId) {
  const key = Number(employeeId);
  return onlineUsers.has(key) && onlineUsers.get(key).size > 0;
}

function resolveExitId(payload) {
  if (payload == null) return null;
  if (typeof payload === 'object') return payload.exitId ?? payload.id ?? null;
  return payload;
}

const _migCache = new Map();
async function ensureMigrated(dbName) {
  if (_migCache.has(dbName)) return _migCache.get(dbName);
  const p = runTenantMigrations(dbName).catch(() => { _migCache.delete(dbName); });
  _migCache.set(dbName, p);
  return p;
}

let ioInstance = null;

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: socketCorsOrigin,
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });
  ioInstance = io;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, env.JWT.secret);
      if (!decoded?.id || !decoded?.db_name) return next(new Error('Invalid token'));

      socket.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        db_name: decoded.db_name,
        employeeId: decoded.employeeId ?? (decoded.role === 'employee' ? decoded.id : null),
        tenant_id: decoded.tenant_id ?? null,
      };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const { user } = socket;
    let userId = null;

    try {
      await ensureMigrated(user.db_name);
      const pool = getTenantPool(user.db_name);
      userId = await ensureMessagingEmployeeId(pool, user);
      if (!userId) {
        logger.warn(`Socket ${socket.id}: no employee profile for ${user.email}`);
        socket.disconnect(true);
        return;
      }
      socket.messagingEmployeeId = userId;
    } catch (err) {
      logger.error(`Socket auth setup failed for ${socket.id}:`, err);
      socket.disconnect(true);
      return;
    }

    addOnline(userId, socket.id);
    logger.debug('[socket] user joined', { userId, socketId: socket.id });
    socket.join(`user:${userId}`);
    logger.debug('[socket] tenant joined', { dbName: user.db_name, socketId: socket.id });
    socket.join(`tenant:${user.db_name}`);

    io.emit('user:online', { userId });
    socket.emit('online_users_list', { onlineIds: Array.from(onlineUsers.keys()) });

    logger.debug(`Socket connected: ${socket.id} (employee ${userId})`);

    socket.on('join_exit', (payload) => {
      const exitId = resolveExitId(payload);
      if (exitId) socket.join(`exit:${exitId}`);
    });

    socket.on('leave_exit', (payload) => {
      const exitId = resolveExitId(payload);
      if (exitId) socket.leave(`exit:${exitId}`);
    });

    socket.on('join_conversation', (conversationId) => {
      const cid = parseConversationId(conversationId);
      if (cid) socket.join(`conv:${cid}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      const cid = parseConversationId(conversationId);
      if (cid) socket.leave(`conv:${cid}`);
    });

    socket.on('send_message', async ({ conversationId: rawConvId, body }, ack) => {
      try {
        const conversationId = parseConversationId(rawConvId);
        if (!conversationId || !body?.trim()) {
          return ack?.({ error: 'Invalid message' });
        }

        await ensureMigrated(user.db_name);
        const pool = getTenantPool(user.db_name);
        const senderId = socket.messagingEmployeeId;

        const participants = await repo.getConversationParticipants(pool, conversationId);
        if (!participants) return ack?.({ error: 'Conversation not found' });
        if (!isConversationParticipant(participants, senderId)) {
          return ack?.({ error: 'Not a participant' });
        }

        const msg = await repo.insertMessage(pool, {
          conversationId,
          senderId,
          body: body.trim(),
        });

        emitMessageRealtime(conversationId, participants, senderId, msg);
        ack?.({ ok: true, message: formatMessagePayload(msg) });
      } catch (err) {
        logger.error('send_message socket error:', err);
        ack?.({ error: err.message || 'Failed to send message' });
      }
    });

    socket.on('mark_read', async ({ conversationId: rawConvId }) => {
      try {
        const conversationId = parseConversationId(rawConvId);
        if (!conversationId) return;
        await ensureMigrated(user.db_name);
        const pool = getTenantPool(user.db_name);
        const readerId = socket.messagingEmployeeId;
        const participants = await repo.getConversationParticipants(pool, conversationId);
        if (!participants || !isConversationParticipant(participants, readerId)) return;
        await repo.markRead(pool, conversationId, readerId);
        socket.to(`conv:${conversationId}`).emit('messages_read', {
          conversationId,
          readBy: readerId,
        });
      } catch (err) {
        logger.debug('mark_read socket error:', err.message);
      }
    });

    socket.on('typing', ({ conversationId: rawConvId, isTyping }) => {
      const conversationId = parseConversationId(rawConvId);
      if (!conversationId) return;
      const senderId = socket.messagingEmployeeId;
      socket.to(`conv:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: senderId,
        isTyping,
      });
    });

    socket.on('disconnect', () => {
      removeOnline(userId, socket.id);
      if (!isOnline(userId)) {
        io.emit('user:offline', { userId });
      }
      logger.debug(`Socket disconnected: ${socket.id}`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  logger.info('Socket.io initialized (messages + realtime)');
  return io;
}

function getIo() {
  return ioInstance;
}

function getSocket() {
  return ioInstance;
}

function emitTicketUpdate(ticket) {
  if (ioInstance) {
    logger.debug(`Emitting ticket:updated for ticket ${ticket.id}`);
    ioInstance.emit('ticket:updated', ticket);
  }
}

function emitTicketCreated(ticket) {
  if (ioInstance) {
    logger.debug(`Emitting ticket:created for ticket ${ticket.id}`);
    ioInstance.emit('ticket:created', ticket);
  }
}

function emitTicketDeleted(ticketId) {
  if (ioInstance) {
    logger.debug(`Emitting ticket:deleted for ticket ${ticketId}`);
    ioInstance.emit('ticket:deleted', { id: ticketId });
  }
}

module.exports = {
  initSocket,
  onlineUsers,
  isOnline,
  getIo,
  getSocket,
  emitTicketUpdate,
  emitTicketCreated,
  emitTicketDeleted,
};
