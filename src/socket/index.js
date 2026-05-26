'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { socketCorsOrigin } = require('../config/cors');
const { getTenantPool } = require('../config/db');
const { runTenantMigrations } = require('../modules/tenant/tenant.service');
const repo = require('../modules/messages/messages.repository');

// Map: employeeId → Set of socket IDs (one user can have multiple tabs)
const onlineUsers = new Map();

function addOnline(employeeId, socketId) {
  if (!onlineUsers.has(employeeId)) onlineUsers.set(employeeId, new Set());
  onlineUsers.get(employeeId).add(socketId);
}

function removeOnline(employeeId, socketId) {
  const sockets = onlineUsers.get(employeeId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) onlineUsers.delete(employeeId);
}

function isOnline(employeeId) {
  return onlineUsers.has(employeeId) && onlineUsers.get(employeeId).size > 0;
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
  });
  ioInstance = io;

  // ── Auth middleware ──────────────────────────────────────────────────────────
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
      };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const { user } = socket;
    addOnline(user.id, socket.id);

    // Join personal room so we can target this user
    socket.join(`user:${user.id}`);

    // Join tenant-specific room
    socket.join(`tenant:${user.db_name}`);

    // Notify contacts that this user is online
    io.emit('user:online', { userId: user.id });

    // ── join_exit / join_conversation ──────────────────────────────────────────
    socket.on('join_exit', (exitId) => {
      socket.join(`exit:${exitId}`);
    });

    socket.on('leave_exit', (exitId) => {
      socket.leave(`exit:${exitId}`);
    });

    // ── join_conversation ──────────────────────────────────────────────────────
    socket.on('join_conversation', (conversationId) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    // ── send_message ───────────────────────────────────────────────────────────
    socket.on('send_message', async ({ conversationId, body }, ack) => {
      try {
        if (!body?.trim()) return ack?.({ error: 'Empty message' });

        await ensureMigrated(user.db_name);
        const pool = getTenantPool(user.db_name);

        const msg = await repo.insertMessage(pool, {
          conversationId,
          senderId: user.id,
          body: body.trim(),
        });

        const payload = {
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_id: msg.sender_id,
          body: msg.body,
          created_at: msg.created_at,
          is_read: false,
        };

        // Broadcast to everyone in the conversation room (including sender)
        io.to(`conv:${conversationId}`).emit('new_message', payload);

        // Also push to the other user's personal room if they're not in the conv room
        io.to(`user:${conversationId}`).emit('conversation:updated', {
          conversationId,
          lastMessage: msg.body,
          lastMessageAt: msg.created_at,
        });

        ack?.({ ok: true, message: payload });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    // ── mark_read ──────────────────────────────────────────────────────────────
    socket.on('mark_read', async ({ conversationId }) => {
      try {
        await ensureMigrated(user.db_name);
        const pool = getTenantPool(user.db_name);
        await repo.markRead(pool, conversationId, user.id);
        // Tell the sender their messages were read
        socket.to(`conv:${conversationId}`).emit('messages_read', {
          conversationId,
          readBy: user.id,
        });
      } catch { /* non-critical */ }
    });

    // ── typing ─────────────────────────────────────────────────────────────────
    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conv:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: user.id,
        isTyping,
      });
    });

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      removeOnline(user.id, socket.id);
      if (!isOnline(user.id)) {
        io.emit('user:offline', { userId: user.id });
      }
    });
  });

  return io;
}

function getIo() {
  return ioInstance;
}

module.exports = { initSocket, onlineUsers, isOnline, getIo };
