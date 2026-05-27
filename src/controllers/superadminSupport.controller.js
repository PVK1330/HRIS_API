const superadminSupportService = require('../services/superadminSupport.service');

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

    const validStatuses = ['Open', 'In Progress', 'Resolved', 'Closed'];
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
  addReply,
};
