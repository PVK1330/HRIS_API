const superadminSupportService = require('../services/superadminSupport.service');
const { emitTicketUpdate, emitTicketDeleted } = require('../socket');
const { pushNotification } = require('../modules/notifications/notifications.service');

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
    console.error('Error listing tickets:', error);
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
    console.error('Error fetching stats:', error);
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

    const ticket = await superadminSupportService.getTicketById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    res.json({
      success: true,
      data: transformTicket(ticket),
    });
  } catch (error) {
    console.error('Error fetching ticket details:', error);
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

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const validStatuses = ['Open', 'In Progress', 'Waiting for Admin', 'Resolved', 'Closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updatedTicket = await superadminSupportService.updateTicketStatus(id, status);

    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Notify the Admin who created the ticket about status change
    try {
      const tenant = { dbName: updatedTicket.dbName };
      const title = 'Support Ticket Updated';
      const message = `Your ticket ${updatedTicket.subject} status changed to ${updatedTicket.status}`;
      await pushNotification(tenant, { employeeId: updatedTicket.admin_id, forAdmin: false, title, message, type: 'SUPPORT_TICKET_UPDATED', ticketId: updatedTicket.id });
    } catch (err) {
      console.error('Failed to push support ticket status-updated notification (superadmin):', err);
    }

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      data: transformTicket(updatedTicket),
    });
  } catch (error) {
    console.error('Error updating ticket status:', error);
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
    const ticket = await superadminSupportService.getTicketById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Add reply
    const reply = await superadminSupportService.addReply(
      id,
      superadminId,
      message,
      internalNotes || null
    );

    // Fetch updated ticket with new reply
    const updatedTicket = await superadminSupportService.getTicketById(id);

    // Notify the Admin who created the ticket about the superadmin reply
    try {
      const tenant = { dbName: updatedTicket.dbName };
      const title = 'Support Ticket Updated';
      const message = `A super admin replied to your ticket: ${updatedTicket.subject}`;
      await pushNotification(tenant, { employeeId: updatedTicket.admin_id, forAdmin: false, title, message, type: 'SUPPORT_TICKET_UPDATED', ticketId: updatedTicket.id });
    } catch (err) {
      console.error('Failed to push support ticket reply notification (superadmin):', err);
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
    console.error('Error adding reply:', error);
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
    const { status, assignedTo, superAdminDescription, internalNotes } = req.body;
    const superadminId = req.user?.id;

    if (!status && !assignedTo && !superAdminDescription) {
      return res.status(400).json({
        success: false,
        message: 'At least one of status, assignedTo, or superAdminDescription is required',
      });
    }

    const validStatuses = ['Open', 'In Progress', 'Waiting for Admin', 'Resolved', 'Closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    let updatedTicket = null;

    if (status || assignedTo || superAdminDescription) {
      updatedTicket = await superadminSupportService.updateTicket(id, { status, assignedTo, superAdminDescription });
    }

    // If super admin provided a description, save it as a reply/message in ticket history
    if (superAdminDescription) {
      if (!superadminId) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Superadmin ID required' });
      }
      await superadminSupportService.addReply(id, superadminId, superAdminDescription, internalNotes || null);
    }

    const refreshedTicket = await superadminSupportService.getTicketById(id);
    if (!refreshedTicket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const transformedTicket = transformTicket(refreshedTicket);

    // Emit real-time update to all connected clients
    emitTicketUpdate(transformedTicket);

    // Notify the Admin who created the ticket about updates from Super Admin
    try {
      const tenant = { dbName: refreshedTicket.dbName };
      const title = 'Support Ticket Updated';
      const message = `Your ticket ${refreshedTicket.subject} status changed to ${refreshedTicket.status}`;
      await pushNotification(tenant, { employeeId: refreshedTicket.admin_id, forAdmin: false, title, message, type: 'SUPPORT_TICKET_UPDATED', ticketId: refreshedTicket.id });
    } catch (err) {
      console.error('Failed to push support ticket updated notification (superadmin):', err);
    }

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: transformedTicket,
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
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

    const deleted = await superadminSupportService.deleteTicket(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // notify clients
    emitTicketDeleted(id);

    res.json({ success: true, message: 'Ticket deleted successfully', data: { id } });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ success: false, message: 'Failed to delete ticket', error: error.message });
  }
}

/**
 * Transform database ticket row to API response format
 */
function transformTicket(ticket) {
  return {
    id: ticket.id,
    adminId: ticket.admin_id,
    adminName: ticket.admin_name,
    tenantId: ticket.tenant_id,
    tenantName: ticket.tenant_name,
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
    messages: (ticket.replies || []).map(transformReply),
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
