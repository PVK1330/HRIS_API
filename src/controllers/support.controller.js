'use strict';

const ApiError = require('../utils/ApiError');
const supportService = require('../services/support.service');

function transformTicket(row) {
  return {
    id: row.id,
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
    messages: (row.replies || []).map((reply) => ({
      id: reply.id,
      ticketId: reply.ticket_id,
      superadminId: reply.superadmin_id,
      text: reply.message,
      internalNotes: reply.internal_notes,
      createdAt: reply.created_at,
      sender: 'Support',
    })),
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
      status: status && status.trim() ? status.trim() : 'Open',
      attachmentUrl,
    });

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
    return res.json({ success: true, data: transformTicket(ticket) });
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
