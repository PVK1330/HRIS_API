'use strict';

const ApiError = require('../utils/ApiError');
const supportService = require('../services/support.service');
const { pushNotification } = require('../modules/notifications/notifications.service');
const socket = require('../socket');
const logger = require('../utils/logger');

function buildConversation(row) {
  const status = row.status || 'Waiting'
  const conversation = [
    {
      id: row.id,
      ticketId: row.id,
      senderRole: 'admin',
      senderName: row.admin_name || 'Admin',
      message: row.description || '',
      status,
      createdAt: row.created_at,
    },
  ]

  const replies = row.replies || row.messages || []
  replies.forEach((reply) => {
    conversation.push({
      id: reply.id,
      ticketId: reply.ticket_id || row.id,
      senderRole: 'superadmin',
      senderName: 'Super Admin',
      message: reply.message || reply.text || '',
      status,
      createdAt: reply.created_at || reply.createdAt,
    })
  })

  return conversation
}

function transformTicket(row) {
  const conversation = buildConversation(row)
  return {
    id: row.id,
    ticketId: `TKT-${String(row.id).padStart(3, '0')}`,
    adminName: row.admin_name,
    tenantName: row.tenant_name,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    description: row.description,
    attachmentUrl: row.attachment_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    conversation,
    messages: conversation,
  };
}

async function createTicket(req, res, next) {
  try {
    const {
      adminName,
      subject,
      category,
      priority,
      description,
      status,
    } = req.body;

    if (!subject || !subject.trim()) {
      throw ApiError.badRequest('Subject is required');
    }
    if (!category || !category.trim()) {
      throw ApiError.badRequest('Category is required');
    }
    if (!priority || !priority.trim()) {
      throw ApiError.badRequest('Priority is required');
    }
    if (!description || !description.trim()) {
      throw ApiError.badRequest('Description is required');
    }

    const attachmentUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const ticket = await supportService.createTicket(req.user, req.tenant, {
      adminName: adminName || req.user.email || 'Admin',
      tenantName: req.tenant.name,
      subject: subject.trim(),
      category: category.trim(),
      priority: priority.trim(),
      description: description.trim(),
      status: status && status.trim() ? status.trim() : 'Waiting',
      attachmentUrl,
    });

    

    // Send notification to Superadmin only
    // Admin creates ticket → notification only for superadmin
    try {
      

      const title = 'New Support Ticket Created';
      const message = `${ticket.admin_name || adminName || 'Admin'} created support ticket: ${ticket.subject}`;
      const notificationPayload = {
        recipientRole: 'superadmin',
        title,
        message,
        type: 'support_ticket',
        ticketId: ticket.id,
        forAdmin: false,  // Use role-based filtering instead
      };

      

      const notification = await pushNotification(req.tenant, notificationPayload);

      
    } catch (err) {
      logger.error('[support] failed to send ticket notification', { err: err.message });
      // Don't fail the response, notification is optional
    }

    // Emit socket event for real-time UI updates
    try {
      socket.emitTicketCreated(ticket, req.tenant?.dbName || req.user?.db_name);
    } catch (err) {
      logger.error('[support] failed to emit ticket created event', { err: err.message });
    }

    return res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: transformTicket(ticket),
    });
  } catch (err) {
    return next(err);
  }
}

async function listTickets(req, res, next) {
  try {
    const rows = await supportService.listTickets(req.user);
    
    return res.json({
      success: true,
      data: rows.map(transformTicket),
    });
  } catch (err) {
    return next(err);
  }
}

async function getTicketById(req, res, next) {
  try {
    const ticket = await supportService.getTicketById(req.user, req.params.id);
    const transformed = transformTicket(ticket)
    return res.json({ success: true, data: transformed });
  } catch (err) {
    return next(err);
  }
}

async function updateTicket(req, res, next) {
  try {
    const {
      subject,
      category,
      priority,
      description,
      status,
    } = req.body;

    const payload = {};
    if (subject != null) payload.subject = subject.trim();
    if (category != null) payload.category = category.trim();
    if (priority != null) payload.priority = priority.trim();
    if (description != null) payload.description = description.trim();
    if (status != null) payload.status = status.trim();
    if (req.file) payload.attachmentUrl = `/uploads/${req.file.filename}`;

    const ticket = await supportService.updateTicket(req.user, req.params.id, payload);

    // Send notification to the Admin who created this ticket
    // Send to the specific admin only
    try {
      const title = 'Support Ticket Updated';
      const message = `Your support ticket "${ticket.subject}" status changed to ${ticket.status}`;
      await pushNotification(req.tenant, { 
        recipientId: ticket.admin_id, 
        recipientRole: 'admin',
        title, 
        message, 
        type: 'support_ticket', 
        ticketId: ticket.id,
        forAdmin: false
      });
    } catch (err) {
      logger.error('[support] failed to send ticket update notification', { err: err.message });
      // Don't fail the response, notification is optional
    }

    // Emit socket event for real-time UI updates
    try {
      socket.emitTicketUpdate(ticket, req.tenant?.dbName || req.user?.db_name);
    } catch (err) {
      logger.error('[support] failed to emit ticket updated event', { err: err.message });
    }
    return res.json({ success: true, data: transformTicket(ticket) });
  } catch (err) {
    return next(err);
  }
}

async function deleteTicket(req, res, next) {
  try {
    await supportService.deleteTicket(req.user, req.params.id);
    return res.json({ success: true, message: 'Support ticket deleted successfully' });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createTicket,
  listTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
};
