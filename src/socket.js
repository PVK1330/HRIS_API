const socketIo = require('socket.io');
const logger = require('./utils/logger');

let io = null;

/**
 * Initialize Socket.io server
 * @param {http.Server} server - HTTP server instance
 * @returns {socketIo.Server} Socket.io instance
 */
function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || ['http://localhost:5173', 'http://localhost:5174'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Middleware to authenticate socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    // Token validation can be added here if needed
    socket.user = { authenticated: true };
    next();
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket.io client connected: ${socket.id}`);

    // Handle client disconnect
    socket.on('disconnect', () => {
      logger.debug(`Socket.io client disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket.io error for client ${socket.id}:`, error);
    });
  });

  logger.info('Socket.io initialized');
  return io;
}

/**
 * Get Socket.io instance
 * @returns {socketIo.Server} Socket.io instance
 */
function getSocket() {
  return io;
}

/**
 * Emit ticket update event to all connected clients
 * @param {Object} ticket - Updated ticket object
 */
function emitTicketUpdate(ticket) {
  if (io) {
    logger.debug(`Emitting ticket:updated event for ticket ${ticket.id}`);
    io.emit('ticket:updated', ticket);
  }
}

/**
 * Emit ticket creation event to all connected clients
 * @param {Object} ticket - New ticket object
 */
function emitTicketCreated(ticket) {
  if (io) {
    logger.debug(`Emitting ticket:created event for ticket ${ticket.id}`);
    io.emit('ticket:created', ticket);
  }
}

/**
 * Emit ticket deletion event to all connected clients
 * @param {number} ticketId - ID of deleted ticket
 */
function emitTicketDeleted(ticketId) {
  if (io) {
    logger.debug(`Emitting ticket:deleted event for ticket ${ticketId}`);
    io.emit('ticket:deleted', { id: ticketId });
  }
}

module.exports = {
  initSocket,
  getSocket,
  emitTicketUpdate,
  emitTicketCreated,
  emitTicketDeleted,
};
