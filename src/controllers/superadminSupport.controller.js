const superadminSupportService = require('../services/superadminSupport.service');
const { emitTicketUpdate, emitTicketDeleted, getIo } = require('../socket');
const { pushNotification } = require('../modules/notifications/notifications.service');
const logger = require('../utils/logger');

/**
 * Superadmin Support Controller
 * Handles HTTP requests for superadmin support ticket management
 */

/**
 * GET /api/superadmin/support/tickets
 * Fetch all support tickets with optional filtering and pagination
 */
async function listAllTickets(req, res) {
  try {
    const { status, priority, category, search, page = 1, limit = 10 } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
    const offset = (pageNum - 1) * pageLimit;

    // Build filter object
    const filter = {
      status: status || null,
      priority: priority || null,
      category: category || null,
      searchTerm: search || null,
    };

    // Fetch tickets and total count
    const [tickets, totalCount] = await Promise.all([
      superadminSupportService.getAllTickets(filter, { limit: pageLimit, offset }),
      superadminSupportService.getTicketsCount(filter),
    ]);

    

    // Transform tickets
    const transformedTickets = tickets.map(transformTicket);

    res.json({
      success: true,
      data: transformedTickets,
      pagination: {
        current: pageNum,
        limit: pageLimit,
        total: totalCount,
        pages: Math.ceil(totalCount / pageLimit),
      },
    });
  } catch (error) {
    logger.error('[superadmin-support] error listing tickets', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support tickets',
      error: error.message,
    });
  }
}

/**
 * GET /api/superadmin/support/tickets/stats
 * Get statistics for all support tickets
 */
async function getStats(req, res) {
  try {
    const stats = await superadminSupportService.getTicketStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('[superadmin-support] error fetching stats', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket statistics',
      error: error.message,
    });
  }
}

/**
 * GET /api/superadmin/support/tickets/:id
 * Fetch single ticket details with replies
 */
async function getTicketDetails(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.query.tenantDb || null;

    const ticket = await superadminSupportService.getTicketById(id, tenantDb);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const transformed = transformTicket(ticket)
    res.json({
      success: true,
      data: transformed,
    });
  } catch (error) {
    logger.error('[superadmin-support] error fetching ticket details', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket details',
      error: error.message,
    });
  }
}

/**
 * PUT /api/superadmin/support/tickets/:id/status
 * Update ticket status
 */
async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const tenantDb = req.body.tenantDb || req.query.tenantDb || null;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const validStatuses = ['Open', 'Waiting', 'In Progress', 'Waiting for Admin', 'Resolved', 'Closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updatedTicket = await superadminSupportService.updateTicketStatus(id, status, tenantDb);

    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Notify the Admin who created the ticket about status change
    // Superadmin updates ticket → notification only for the ticket creator admin
    try {
      const tenant = { dbName: updatedTicket.dbName };
      const title = 'Support Ticket Updated';
      const message = `Your ticket ${updatedTicket.subject} status changed to ${updatedTicket.status}`;
      const notification = await pushNotification(tenant, { 
        recipientId: updatedTicket.admin_id,  // Specific admin who created the ticket
        recipientRole: 'admin',
        title, 
        message, 
        type: 'SUPPORT_TICKET_UPDATED', 
        ticketId: updatedTicket.id,
        forAdmin: false
      });
      
      logger.info('[superadmin-support] notification created for admin', { adminId: updatedTicket.admin_id });

      // Emit socket event to the admin if they're online
      try {
        const io = getIo();
        if (io && updatedTicket.admin_id) {
          logger.debug('[superadmin-support] emitting notification event', { adminId: updatedTicket.admin_id });
          io.to(`user:${updatedTicket.admin_id}`).emit('new_notification', {
            id: notification?.id,
            title,
            message,
            type: 'SUPPORT_TICKET_UPDATED',
            ticketId: updatedTicket.id,
          });
        }
      } catch (socketErr) {
        logger.error('[superadmin-support] failed to emit socket event', { err: socketErr.message });
      }
    } catch (err) {
      logger.error('[superadmin-support] failed to push status-updated notification', { err: err.message });
    }

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      data: transformTicket(updatedTicket),
    });
  } catch (error) {
    logger.error('[superadmin-support] error updating ticket status', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket status',
      error: error.message,
    });
  }
}

/**
 * POST /api/superadmin/support/tickets/:id/reply
 * Add a reply/response to a support ticket
 */
async function addReply(req, res) {
  try {
    const { id } = req.params;
    const { message, internalNotes } = req.body;
    const tenantDb = req.body.tenantDb || null;
    const superadminId = req.user?.id;

    if (!superadminId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Superadmin ID required',
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply message is required',
      });
    }

    // Verify ticket exists
    const ticket = await superadminSupportService.getTicketById(id, tenantDb);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Add reply (scoped to the ticket's owning tenant)
    const reply = await superadminSupportService.addReply(
      id,
      superadminId,
      message,
      internalNotes || null,
      ticket.dbName || tenantDb
    );

    // Fetch updated ticket with new reply
    const updatedTicket = await superadminSupportService.getTicketById(id, ticket.dbName || tenantDb);

    // Notify the Admin who created the ticket about the superadmin reply
    // Superadmin replies → notification only for the ticket creator admin
    try {
      const tenant = { dbName: updatedTicket.dbName };
      const title = 'Support Ticket Updated';
      const messageText = `A super admin replied to your ticket: ${updatedTicket.subject}`;
      const notification = await pushNotification(tenant, { 
        recipientId: updatedTicket.admin_id,  // Specific admin who created the ticket
        recipientRole: 'admin',
        title, 
        message: messageText, 
        type: 'SUPPORT_TICKET_UPDATED', 
        ticketId: updatedTicket.id,
        forAdmin: false
      });
      
      logger.info('[superadmin-support] notification created for admin', { adminId: updatedTicket.admin_id });

      // Emit socket event to the admin if they're online
      try {
        const io = getIo();
        if (io && updatedTicket.admin_id) {
          logger.debug('[superadmin-support] emitting notification event', { adminId: updatedTicket.admin_id });
          io.to(`user:${updatedTicket.admin_id}`).emit('new_notification', {
            id: notification?.id,
            title,
            message: messageText,
            type: 'SUPPORT_TICKET_UPDATED',
            ticketId: updatedTicket.id,
          });
        }
      } catch (socketErr) {
        logger.error('[superadmin-support] failed to emit socket event', { err: socketErr.message });
      }
    } catch (err) {
      logger.error('[superadmin-support] failed to push reply notification', { err: err.message });
    }

    res.json({
      success: true,
      message: 'Reply added successfully',
      data: {
        reply: transformReply(reply),
        ticket: transformTicket(updatedTicket),
      },
    });
  } catch (error) {
    logger.error('[superadmin-support] error adding reply', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to add reply',
      error: error.message,
    });
  }
}

/**
 * PATCH /api/superadmin/support/tickets/:id
 * Update ticket details, status, or add an admin reply
 */
async function updateTicket(req, res) {
  try {
    const { id } = req.params;
    const { status, message, assignedTo, internalNotes } = req.body;
    const tenantDb = req.body.tenantDb || null;
    const superadminId = req.user?.id;

    if (!status && !message && !assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'At least one of status, message, or assignedTo is required',
      });
    }

    const validStatuses = ['Open', 'Waiting', 'In Progress', 'Waiting for Admin', 'Resolved', 'Closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const shouldSaveMessage = message && message.trim();
    if ((status || shouldSaveMessage) && !shouldSaveMessage) {
      return res.status(400).json({
        success: false,
        message: 'Response message is required when changing status or adding a reply',
      });
    }

    const payload = { status, assignedTo };
    if (status || assignedTo) {
      await superadminSupportService.updateTicket(id, payload, tenantDb);
    }

    if (shouldSaveMessage) {
      if (!superadminId) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Superadmin ID required' });
      }

      await superadminSupportService.addReply(id, superadminId, message.trim(), internalNotes || null, tenantDb);
    }

    const refreshedTicket = await superadminSupportService.getTicketById(id, tenantDb);
    if (!refreshedTicket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const transformedTicket = transformTicket(refreshedTicket);

    // Emit real-time update to the owning tenant's room (not every tenant).
    emitTicketUpdate(transformedTicket, refreshedTicket.dbName);

    // Notify the Admin who created the ticket about updates from Super Admin
    try {
      const tenant = { dbName: refreshedTicket.dbName };
      const title = 'Support Ticket Updated';
      const messageNotification = `Your ticket ${refreshedTicket.subject} status changed to ${refreshedTicket.status}`;
      const notification = await pushNotification(tenant, { 
        recipientId: refreshedTicket.admin_id,  // Specific admin who created the ticket
        recipientRole: 'admin',
        title, 
        message: messageNotification, 
        type: 'SUPPORT_TICKET_UPDATED', 
        ticketId: refreshedTicket.id,
        forAdmin: false
      });
      
      logger.info('[superadmin-support] notification created for admin', { adminId: refreshedTicket.admin_id });

      // Emit socket event to the admin if they're online
      try {
        const io = getIo();
        if (io && refreshedTicket.admin_id) {
          logger.debug('[superadmin-support] emitting notification event', { adminId: refreshedTicket.admin_id });
          io.to(`user:${refreshedTicket.admin_id}`).emit('new_notification', {
            id: notification?.id,
            title,
            message: messageNotification,
            type: 'SUPPORT_TICKET_UPDATED',
            ticketId: refreshedTicket.id,
          });
        }
      } catch (socketErr) {
        logger.error('[superadmin-support] failed to emit socket event', { err: socketErr.message });
      }
    } catch (err) {
      logger.error('[superadmin-support] failed to push updated notification', { err: err.message });
    }

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: transformedTicket,
    });
  } catch (error) {
    logger.error('[superadmin-support] error updating ticket', { err: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket',
      error: error.message,
    });
  }
}

/**
 * DELETE /api/superadmin/support/tickets/:id
 * Delete a ticket (and its replies) across tenants
 */
async function deleteTicket(req, res) {
  try {
    const { id } = req.params;
    const tenantDb = req.query.tenantDb || null;

    // Capture the owning tenant BEFORE deletion so the realtime event is scoped
    // to that tenant's room rather than broadcast to every tenant.
    const existing = await superadminSupportService.getTicketById(id, tenantDb);
    const deleted = await superadminSupportService.deleteTicket(id, existing?.dbName || tenantDb);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // notify the owning tenant's clients
    emitTicketDeleted(id, existing?.dbName);

    res.json({ success: true, message: 'Ticket deleted successfully', data: { id } });
  } catch (error) {
    logger.error('[superadmin-support] error deleting ticket', { err: error.message });
    res.status(500).json({ success: false, message: 'Failed to delete ticket', error: error.message });
  }
}

/**
 * Transform database ticket row to API response format
 */
function buildConversation(ticket) {
  const conversation = [
    {
      id: ticket.id,
      ticketId: ticket.id,
      senderRole: 'admin',
      senderName: ticket.admin_name || 'Admin',
      message: ticket.description || '',
      status: ticket.status,
      createdAt: ticket.created_at,
    },
  ]

  const replies = ticket.replies || []
  replies.forEach((reply) => {
    const role = reply.sender_role === 'admin' ? 'admin' : 'superadmin'
    conversation.push({
      id: reply.id,
      ticketId: reply.ticket_id,
      senderRole: role,
      senderName: role === 'admin' ? (ticket.admin_name || 'Admin') : 'Super Admin',
      message: reply.message,
      status: ticket.status,
      createdAt: reply.created_at,
    })
  })

  return conversation
}

function transformTicket(ticket) {
  const conversation = buildConversation(ticket)
  return {
    id: ticket.id,
    ticketId: `TKT-${String(ticket.id).padStart(3, '0')}`,
    adminId: ticket.admin_id,
    adminName: ticket.admin_name,
    tenantId: ticket.tenant_id,
    tenantName: ticket.tenant_name,
    // Owning tenant db_name — the FE echoes this back on by-id calls so superadmin
    // actions hit the right tenant (per-tenant serial ids collide across tenants).
    dbName: ticket.dbName || ticket.tenant_db || null,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    description: ticket.description,
    attachmentUrl: ticket.attachment_url,
    status: ticket.status,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    closedAt: ticket.closed_at,
    replyCount: ticket.reply_count || 0,
    replies: (ticket.replies || []).map(transformReply),
    messages: conversation,
    conversation,
  };
}

/**
 * Transform database reply row to API response format
 */
function transformReply(reply) {
  return {
    id: reply.id,
    ticketId: reply.ticket_id,
    superadminId: reply.superadmin_id,
    message: reply.message,
    internalNotes: reply.internal_notes,
    createdAt: reply.created_at,
  };
}

module.exports = {
  listAllTickets,
  getStats,
  getTicketDetails,
  updateStatus,
  updateTicket,
  addReply,
  deleteTicket,
};
