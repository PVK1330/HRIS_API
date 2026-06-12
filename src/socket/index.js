'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { socketCorsOrigin } = require('../config/cors');
const { getTenantPool } = require('../config/db');
const { createRedisClient, isEnabled: redisEnabled } = require('../config/redis');
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

function addOnline(dbName, employeeId, socketId) {
  const key = Number(employeeId);
  if (!onlineUsers.has(dbName)) onlineUsers.set(dbName, new Map());
  const tenantMap = onlineUsers.get(dbName);
  if (!tenantMap.has(key)) tenantMap.set(key, new Set());
  tenantMap.get(key).add(socketId);
}

function removeOnline(dbName, employeeId, socketId) {
  const key = Number(employeeId);
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

// ── Presence heartbeat / TTL ────────────────────────────────────────────────
// Engine.io disconnects dead sockets on its own ping-timeout, but if that
// `disconnect` is ever missed (process hiccup, half-open TCP, a dropped close
// frame) the in-memory presence Map keeps a user "online" forever — a stale dot
// that never clears. As a backstop we stamp a last-seen time per socket,
// refreshed by the transport heartbeat, any app event, and an explicit client
// `heartbeat`. A sweeper expires sockets that go silent past PRESENCE_TTL_MS and
// broadcasts the offline transition to the owning tenant room (never globally).
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS) || 60_000;
const PRESENCE_SWEEP_MS = Number(process.env.PRESENCE_SWEEP_MS) || 15_000;
const socketLastSeen = new Map(); // socketId -> { dbName, userId, lastSeen }

function trackPresence(socketId, dbName, userId) {
  socketLastSeen.set(socketId, { dbName, userId: Number(userId), lastSeen: Date.now() });
}

function touchPresence(socketId) {
  const e = socketLastSeen.get(socketId);
  if (e) e.lastSeen = Date.now();
}

// Emit offline to the tenant room ONLY when the user has no live sockets left.
function announceOfflineIfGone(io, dbName, userId) {
  if (!isOnline(dbName, userId)) {
    io.to(`tenant:${dbName}`).emit('user:offline', { userId: Number(userId) });
  }
}

// Remove one socket from presence (used by both graceful disconnect and the
// TTL sweeper) and announce offline if it was the user's last connection.
function dropSocketPresence(io, socketId) {
  const e = socketLastSeen.get(socketId);
  if (!e) return;
  socketLastSeen.delete(socketId);
  removeOnline(e.dbName, e.userId, socketId);
  announceOfflineIfGone(io, e.dbName, e.userId);
}

function startPresenceSweeper(io) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [socketId, e] of socketLastSeen) {
      if (now - e.lastSeen <= PRESENCE_TTL_MS) continue;
      logger.debug(`[presence] expiring stale socket ${socketId} (employee ${e.userId}, tenant ${e.dbName})`);
      dropSocketPresence(io, socketId);
      const s = io.sockets.sockets.get(socketId);
      if (s) s.disconnect(true);
    }
  }, PRESENCE_SWEEP_MS);
  timer.unref?.();
  return timer;
}

// ── Cross-instance fan-out (horizontal scaling) ─────────────────────────────
// The default Socket.IO adapter keeps rooms/sockets in THIS process's memory, so
// across multiple API instances a broadcast (new_message, presence, tickets)
// only reaches clients connected to the SAME instance — everyone else silently
// misses it. When Redis is configured we attach the Redis adapter so every emit
// fans out to all instances. Falls back to the in-memory adapter (single
// instance) when Redis is unset or the optional package isn't installed.
//
// ⚠ LOAD BALANCER — STICKY SESSIONS REQUIRED: Socket.IO's HTTP long-polling
// handshake spans several requests that MUST land on the same instance, so the
// LB MUST enable session affinity (e.g. nginx `ip_hash` or hash on the `io`
// cookie; AWS ALB target-group stickiness on the `io` cookie). The Redis adapter
// handles message fan-out, NOT handshake routing — without stickiness clients
// get repeated "Session ID unknown" handshake errors. (Forcing the pure
// `websocket` transport sidesteps polling, but polling is the default fallback.)
function attachRedisAdapter(io) {
  if (!redisEnabled()) {
    logger.info('[socket] Redis not configured — using in-memory adapter (single-instance only).');
    return;
  }
  let createAdapter;
  try {
    ({ createAdapter } = require('@socket.io/redis-adapter'));
  } catch {
    logger.warn(
      "[socket] REDIS_* set but '@socket.io/redis-adapter' is not installed — using in-memory " +
      'adapter. Install for multi-instance: npm i @socket.io/redis-adapter',
    );
    return;
  }
  const pubClient = createRedisClient('socket-pub');
  const subClient = createRedisClient('socket-sub');
  if (!pubClient || !subClient) {
    logger.warn('[socket] Redis clients unavailable — using in-memory adapter.');
    return;
  }
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('[socket] Redis adapter attached — cross-instance fan-out enabled.');
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
    // Engine-level heartbeat: server pings every 25s and considers a socket dead
    // if no pong arrives within 20s. This is the first line of stale-presence
    // defense; the PRESENCE_TTL_MS sweeper above is the backstop.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });
  ioInstance = io;

  // Horizontal scaling: cross-instance fan-out (no-op/in-memory without Redis).
  attachRedisAdapter(io);
  // Stale-presence backstop: expire sockets that stop heartbeating.
  startPresenceSweeper(io);

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
      // READ-ONLY resolve (no auto-provision on the connect path). May be null for
      // a tenant user who has no employee profile yet; that's NOT fatal — the same
      // socket also carries ticket/exit realtime, so we keep it connected and join
      // the tenant room regardless. Messaging identity is created on the first
      // deliberate action (openConversation) via the REST provisioning flow.
      userId = await ensureMessagingEmployeeId(pool, user);
      socket.messagingEmployeeId = userId || null;
    } catch (err) {
      logger.error(`Socket auth setup failed for ${socket.id}:`, err);
      socket.disconnect(true);
      return;
    }

    // Tenant room is for ALL tenant-scoped realtime (tickets, exit, presence) and
    // must be joined whether or not the user has a messaging identity.
    socket.join(`tenant:${user.db_name}`);
    logger.debug('[socket] tenant joined', { dbName: user.db_name, socketId: socket.id });

    // Refresh last-seen on the transport heartbeat (pong), on ANY app event, and
    // on an explicit client `heartbeat` — so an active socket never gets swept.
    socket.conn.on('heartbeat', () => touchPresence(socket.id));
    socket.onAny(() => touchPresence(socket.id));
    socket.on('heartbeat', (ack) => {
      touchPresence(socket.id);
      if (typeof ack === 'function') ack({ ok: true });
    });

    // Messaging presence only applies to users with an employee identity.
    if (userId) {
      addOnline(user.db_name, userId, socket.id);
      trackPresence(socket.id, user.db_name, userId);
      logger.debug('[socket] user joined', { userId, socketId: socket.id });
      socket.join(`user:${userId}`);
      // Presence is scoped to this tenant's room only — never broadcast globally.
      io.to(`tenant:${user.db_name}`).emit('user:online', { userId });
      socket.emit('online_users_list', { onlineIds: onlineIdsForTenant(user.db_name) });
    } else {
      logger.debug(`Socket ${socket.id}: no messaging profile for ${user.email} — connected for non-messaging realtime only`);
    }

    logger.debug(`Socket connected: ${socket.id} (employee ${userId ?? 'none'})`);

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

    socket.on('send_message', async ({ conversationId: rawConvId, body, clientId }, ack) => {
      try {
        const conversationId = parseConversationId(rawConvId);
        if (!conversationId || !body?.trim()) {
          return ack?.({ error: 'Invalid message' });
        }

        const senderId = socket.messagingEmployeeId;
        if (!senderId) return ack?.({ error: 'No messaging profile' });

        await ensureMigrated(user.db_name);
        const pool = getTenantPool(user.db_name);

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

        // Echo the sender's stable client temp id back on the realtime payload so
        // their own tab can reconcile the optimistic placeholder by id (not body).
        emitMessageRealtime(conversationId, participants, senderId, msg, clientId);
        ack?.({ ok: true, message: { ...formatMessagePayload(msg), client_id: clientId ?? null } });
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
      if (!senderId) return;
      socket.to(`conv:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: senderId,
        isTyping,
      });
    });

    socket.on('disconnect', () => {
      // Removes this socket from presence and announces offline to THIS tenant's
      // room only (never globally) when it was the user's last connection. Same
      // path the TTL sweeper uses for ungraceful drops.
      dropSocketPresence(io, socket.id);
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
