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

// Presence is tracked PER TENANT (db_name) so employee-id collisions across
// tenants can't flip the wrong contact's online dot, and snapshots/broadcasts
// never leak one tenant's presence into another.
//   onlineUsers: Map<dbName, Map<employeeId, Set<socketId>>>
const onlineUsers = new Map();

// Heartbeat/TTL so presence expires on ungraceful disconnect (lost network,
// killed tab) where no 'disconnect' event fires. Each socket records a last-seen
// timestamp, refreshed on any client heartbeat/activity; a periodic sweep drops
// sockets whose last-seen is older than PRESENCE_TTL_MS and announces offline.
// In-process only (no Redis) — sufficient for a single-node deployment.
//   socketSeen: Map<socketId, { dbName, employeeId, lastSeen }>
const socketSeen = new Map();
const PRESENCE_TTL_MS = 60 * 1000;
const PRESENCE_SWEEP_MS = 20 * 1000;

function touchSocket(socketId) {
  const entry = socketSeen.get(socketId);
  if (entry) entry.lastSeen = Date.now();
}

function addOnline(dbName, employeeId, socketId) {
  const key = Number(employeeId);
  if (!onlineUsers.has(dbName)) onlineUsers.set(dbName, new Map());
  const tenantMap = onlineUsers.get(dbName);
  if (!tenantMap.has(key)) tenantMap.set(key, new Set());
  tenantMap.get(key).add(socketId);
  socketSeen.set(socketId, { dbName, employeeId: key, lastSeen: Date.now() });
}

function removeOnline(dbName, employeeId, socketId) {
  const key = Number(employeeId);
  socketSeen.delete(socketId);
  const tenantMap = onlineUsers.get(dbName);
  if (!tenantMap) return;
  const sockets = tenantMap.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) tenantMap.delete(key);
  if (tenantMap.size === 0) onlineUsers.delete(dbName);
}

function isOnline(dbName, employeeId) {
  const key = Number(employeeId);
  const tenantMap = onlineUsers.get(dbName);
  return !!tenantMap && tenantMap.has(key) && tenantMap.get(key).size > 0;
}

// Online employee ids for ONE tenant — used for the initial presence snapshot.
function onlineIdsForTenant(dbName) {
  const tenantMap = onlineUsers.get(dbName);
  return tenantMap ? Array.from(tenantMap.keys()) : [];
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

  // TTL sweep: drop presence for sockets that went silent (ungraceful
  // disconnect) and announce offline to the owning tenant once their last
  // socket is gone. Runs in-process; .unref() so it never blocks shutdown.
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [socketId, entry] of socketSeen) {
      if (now - entry.lastSeen <= PRESENCE_TTL_MS) continue;
      const { dbName, employeeId } = entry;
      removeOnline(dbName, employeeId, socketId);
      const sock = io.sockets.sockets.get(socketId);
      if (sock) sock.disconnect(true);
      if (!isOnline(dbName, employeeId)) {
        io.to(`tenant:${dbName}`).emit('user:offline', { userId: employeeId });
      }
      logger.debug(`[socket] presence TTL expired for ${socketId} (employee ${employeeId})`);
    }
  }, PRESENCE_SWEEP_MS);
  if (sweepTimer.unref) sweepTimer.unref();

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

    addOnline(user.db_name, userId, socket.id);
    logger.debug('[socket] user joined', { userId, socketId: socket.id });
    socket.join(`user:${userId}`);
    logger.debug('[socket] tenant joined', { dbName: user.db_name, socketId: socket.id });
    socket.join(`tenant:${user.db_name}`);

    // Presence is scoped to this tenant's room only — never broadcast globally.
    io.to(`tenant:${user.db_name}`).emit('user:online', { userId });
    socket.emit('online_users_list', { onlineIds: onlineIdsForTenant(user.db_name) });

    logger.debug(`Socket connected: ${socket.id} (employee ${userId})`);

    // Heartbeat: clients emit 'heartbeat' periodically; any inbound packet also
    // refreshes last-seen so an active connection never gets swept. Socket.io's
    // own ping/pong covers most drops, but this gives an explicit app-level TTL.
    socket.on('heartbeat', () => touchSocket(socket.id));
    socket.onAny(() => touchSocket(socket.id));

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

    socket.on('send_message', async ({ conversationId: rawConvId, body, clientMsgId }, ack) => {
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

        emitMessageRealtime(conversationId, participants, senderId, msg, clientMsgId);
        const ackPayload = formatMessagePayload(msg);
        if (clientMsgId) ackPayload.client_msg_id = clientMsgId;
        ack?.({ ok: true, message: ackPayload });
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
      removeOnline(user.db_name, userId, socket.id);
      // Only announce offline to this tenant's room — never globally.
      if (!isOnline(user.db_name, userId)) {
        io.to(`tenant:${user.db_name}`).emit('user:offline', { userId });
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

// Ticket events are scoped to the OWNING tenant's room so one tenant's support
// activity never broadcasts to every other tenant. The caller passes the tenant
// db_name (falling back to a db_name carried on the ticket payload). If no tenant
// can be resolved we SKIP rather than broadcast globally.
function ticketRoom(dbName, ticket) {
  return dbName || ticket?.dbName || ticket?.db_name || null;
}

function emitTicketUpdate(ticket, dbName) {
  if (!ioInstance) return;
  const room = ticketRoom(dbName, ticket);
  if (!room) { logger.warn(`[socket] ticket:updated for ${ticket?.id} has no tenant — skipped`); return; }
  logger.debug(`Emitting ticket:updated for ticket ${ticket.id} -> tenant:${room}`);
  ioInstance.to(`tenant:${room}`).emit('ticket:updated', ticket);
}

function emitTicketCreated(ticket, dbName) {
  if (!ioInstance) return;
  const room = ticketRoom(dbName, ticket);
  if (!room) { logger.warn(`[socket] ticket:created for ${ticket?.id} has no tenant — skipped`); return; }
  logger.debug(`Emitting ticket:created for ticket ${ticket.id} -> tenant:${room}`);
  ioInstance.to(`tenant:${room}`).emit('ticket:created', ticket);
}

function emitTicketDeleted(ticketId, dbName) {
  if (!ioInstance) return;
  if (!dbName) { logger.warn(`[socket] ticket:deleted for ${ticketId} has no tenant — skipped`); return; }
  logger.debug(`Emitting ticket:deleted for ticket ${ticketId} -> tenant:${dbName}`);
  ioInstance.to(`tenant:${dbName}`).emit('ticket:deleted', { id: ticketId });
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
