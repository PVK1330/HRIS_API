'use strict';

const { getTenantPool, pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { ensureMigrated } = require('../utils/tenantMigration');
const { sendMail } = require('../utils/mail');
const logger = require('../utils/logger');

function getPool(user) {
  if (!user || !user.db_name) {
    throw ApiError.unauthorized('Tenant context missing');
  }
  return getTenantPool(user.db_name);
}

async function createTicket(user, tenant, ticketData) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const query = `
    INSERT INTO support_tickets (
      admin_id,
      admin_name,
      tenant_id,
      tenant_name,
      subject,
      category,
      priority,
      description,
      attachment_url,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const values = [
    user.id,
    ticketData.adminName || '',
    tenant.id,
    ticketData.tenantName || tenant.name,
    ticketData.subject,
    ticketData.category,
    ticketData.priority,
    ticketData.description,
    ticketData.attachmentUrl || null,
    ticketData.status || 'Waiting',
  ];

  const { rows } = await pool.query(query, values);
  const ticketRecord = rows[0];

  // Send email to superadmin about new ticket (non-blocking).
  // `ticketId` is declared OUTSIDE the try so the catch can still reference it
  // — previously it was scoped inside the try, so any email failure threw a
  // ReferenceError in the catch and turned a successful ticket creation into a 500.
  const ticketId = `TKT-${String(ticketRecord.id).padStart(3, '0')}`;
  try {
    let superadminEmail = null;
    try {
      const saResult = await pool.query(`
        SELECT id, username, email, role FROM users
        WHERE LOWER(role) IN ('superadmin', 'super_admin')
        AND COALESCE(email, username) IS NOT NULL
        LIMIT 1
      `);
      if (saResult.rows.length > 0) {
        const saUser = saResult.rows[0];
        const rawEmail = saUser.email || saUser.username;
        const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
        if (isEmailValid) {
          superadminEmail = rawEmail;
          logger.debug('[support] selected superadmin recipient');
        } else {
          logger.warn('[support] superadmin identifier is not a valid email');
        }
      }
    } catch (err) {
      logger.error('[support] error fetching superadmin email', { err: err.message });
    }

    if (!superadminEmail) {
      logger.warn('[support] no valid superadmin email found, skipping notification');
    }

    if (superadminEmail) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb;">
          <div style="background-color: #0F766E; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0;">New Support Ticket</h1>
          </div>
          <div style="padding: 20px; background-color: #ffffff; border-radius: 0 0 8px 8px;">
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hello Superadmin,</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">A new support ticket has been created and requires your attention.</p>
            
            <h2 style="color: #1F2937; font-size: 18px; margin-top: 24px; margin-bottom: 12px;">Ticket Details</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937; width: 40%;">Ticket ID:</td>
                <td style="padding: 12px; color: #374151;">${ticketId}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937;">Admin Name:</td>
                <td style="padding: 12px; color: #374151;">${ticketData.adminName || 'N/A'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937;">Company/Tenant:</td>
                <td style="padding: 12px; color: #374151;">${ticketData.tenantName || tenant.name}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937;">Subject:</td>
                <td style="padding: 12px; color: #374151;">${ticketData.subject}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937;">Category:</td>
                <td style="padding: 12px; color: #374151;">${ticketData.category}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px; font-weight: bold; color: #1F2937;">Priority:</td>
                <td style="padding: 12px; color: #374151;"><span style="background-color: ${ticketData.priority === 'High' ? '#FEE2E2' : ticketData.priority === 'Medium' ? '#FEF3C7' : '#DBEAFE'}; padding: 4px 8px; border-radius: 4px; color: ${ticketData.priority === 'High' ? '#DC2626' : ticketData.priority === 'Medium' ? '#D97706' : '#2563EB'}; font-weight: bold;">${ticketData.priority}</span></td>
              </tr>
              <tr>
                <td style="padding: 12px; font-weight: bold; color: #1F2937; vertical-align: top;">Description:</td>
                <td style="padding: 12px; color: #374151;">${ticketData.description}</td>
              </tr>
            </table>
            
            <p style="color: #6B7280; font-size: 14px; margin-top: 20px; margin-bottom: 20px;">
              <strong>Created At:</strong> ${ticketRecord.created_at ? new Date(ticketRecord.created_at).toLocaleString() : 'N/A'}
            </p>
            
            <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #374151; margin: 0; line-height: 1.6;">
                Please login to the <strong>Superadmin Portal</strong> to review and respond to this ticket.
              </p>
            </div>
            
            <p style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 24px;">
              Regards,<br/>
              <strong>HRMS Support System</strong>
            </p>
          </div>
        </div>
      `;

      const emailText = `
Hello Superadmin,

A new support ticket has been created and requires your attention.

Ticket Details:
- Ticket ID: ${ticketId}
- Admin Name: ${ticketData.adminName || 'N/A'}
- Company/Tenant: ${ticketData.tenantName || tenant.name}
- Subject: ${ticketData.subject}
- Category: ${ticketData.category}
- Priority: ${ticketData.priority}
- Description: ${ticketData.description}
- Created At: ${ticketRecord.created_at ? new Date(ticketRecord.created_at).toLocaleString() : 'N/A'}

Please login to the Superadmin Portal to review and respond to this ticket.

Regards,
HRMS Support System
      `;

      await sendMail({
        to: superadminEmail,
        subject: `New Support Ticket Created - ${ticketId}`,
        html: emailHtml,
        text: emailText,
      });
    }
  } catch (error) {
    logger.warn('[support] ticket notification email failed', { ticketId, err: error.message });
  }

  return ticketRecord;
}

async function listTickets(user) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const { rows } = await pool.query(
    `SELECT id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at
     FROM support_tickets
     WHERE admin_deleted = false
     ORDER BY created_at DESC`
  );

  return rows;
}

async function getTicketById(user, ticketId) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const { rows } = await pool.query(
    `SELECT id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at, admin_deleted, superadmin_deleted
     FROM support_tickets
     WHERE id = $1 AND admin_deleted = false`,
    [ticketId],
  );

  if (!rows.length) throw ApiError.notFound('Support ticket not found');

  const ticket = rows[0];

  const repliesResult = await pool.query(
    `SELECT id, ticket_id, superadmin_id, message, internal_notes, created_at
     FROM support_ticket_replies
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId],
  );

  return {
    ...ticket,
    replies: repliesResult.rows || [],
  };
}

async function updateTicket(user, ticketId, ticketData) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const allowedFields = [];
  const values = [];
  let idx = 1;

  if (ticketData.subject != null) {
    allowedFields.push(`subject = $${idx++}`);
    values.push(ticketData.subject);
  }
  if (ticketData.category != null) {
    allowedFields.push(`category = $${idx++}`);
    values.push(ticketData.category);
  }
  if (ticketData.priority != null) {
    allowedFields.push(`priority = $${idx++}`);
    values.push(ticketData.priority);
  }
  if (ticketData.description != null) {
    allowedFields.push(`description = $${idx++}`);
    values.push(ticketData.description);
  }
  if (ticketData.status != null) {
    allowedFields.push(`status = $${idx++}`);
    values.push(ticketData.status);
  }
  if (ticketData.attachmentUrl !== undefined) {
    allowedFields.push(`attachment_url = $${idx++}`);
    values.push(ticketData.attachmentUrl);
  }

  if (!allowedFields.length) {
    throw ApiError.badRequest('No updates were provided');
  }

  const query = `
    UPDATE support_tickets
    SET ${allowedFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${idx}
    RETURNING id, admin_id, admin_name, tenant_name, subject, category, priority, description, attachment_url, status, created_at, updated_at
  `;
  values.push(ticketId);

  const { rows } = await pool.query(query, values);
  if (!rows.length) throw ApiError.notFound('Support ticket not found');
  
  const updatedTicket = rows[0];

  // Send email to admin about ticket update (non-blocking)
  try {
    const adminResult = await pool.query(
      `SELECT u.id, u.username, u.name, u.email, u.role
       FROM users u
       WHERE u.id = $1`,
      [updatedTicket.admin_id]
    );

    const admin = adminResult.rows[0];
    let adminEmail = null;
    let adminName = updatedTicket.admin_name || "Admin";

    if (admin) {
      const rawEmail = admin.email || admin.username;
      if (rawEmail) {
        const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
        if (isEmailValid) {
          adminEmail = rawEmail;
          adminName = admin.name || adminName;
          logger.debug('[support] selected admin recipient');
        } else {
          logger.warn('[support] admin identifier is not a valid email');
        }
      }
    }

    if (!adminEmail) {
      logger.warn('[support] no valid admin email found, skipping notification');
    }

    if (adminEmail) {
      await sendMail({
        to: adminEmail,
        subject: `Support Ticket Updated - TKT-${String(updatedTicket.id).padStart(3, '0')}`,
        html: `
          <h2>Support Ticket Updated</h2>
          <p>Hello ${adminName},</p>
          <p>Your support ticket has been updated by Superadmin.</p>

          <p><b>Ticket ID:</b> TKT-${String(updatedTicket.id).padStart(3, '0')}</p>
          <p><b>Subject:</b> ${updatedTicket.subject || "-"}</p>
          <p><b>Category:</b> ${updatedTicket.category || "-"}</p>
          <p><b>Priority:</b> ${updatedTicket.priority || "-"}</p>
          <p><b>Status:</b> ${updatedTicket.status || "-"}</p>
          <p><b>Superadmin Response:</b> ${updatedTicket.description || "-"}</p>
          <p><b>Updated At:</b> ${new Date(updatedTicket.updated_at).toLocaleString()}</p>

          <p>Please login to Admin Portal to view complete ticket details.</p>
          <p>Regards,<br/>HRMS Support Team</p>
        `
      });

      
    } else {
      
    }
  } catch (emailError) {
    logger.error('[support] admin update email failed', { err: emailError.message });
  }

  return updatedTicket;
}

async function deleteTicket(user, ticketId) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  // Soft delete for admin - mark admin_deleted flag
  const { rows } = await pool.query(
    `UPDATE support_tickets 
     SET admin_deleted = true, admin_deleted_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND admin_id = $2
     RETURNING *`,
    [ticketId, user.id],
  );

  if (!rows.length) throw ApiError.notFound('Support ticket not found');

  const ticket = rows[0];

  
  

  // Check if both sides deleted - then hard delete
  if (ticket.admin_deleted && ticket.superadmin_deleted) {
    await hardDeleteTicket(pool, ticketId);
  }

  return true;
}

async function hardDeleteTicket(pool, ticketId) {
  try {
    // Delete ticket replies/conversation history
    await pool.query('DELETE FROM support_ticket_replies WHERE ticket_id = $1', [ticketId]);

    // Delete notifications related to ticket
    await pool.query('DELETE FROM notifications WHERE ticket_id = $1', [ticketId]);

    // Delete ticket attachments (if table exists)
    try {
      await pool.query('DELETE FROM support_ticket_attachments WHERE ticket_id = $1', [ticketId]);
    } catch (err) {
      // Table might not exist
    }

    // Hard delete the ticket
    await pool.query('DELETE FROM support_tickets WHERE id = $1', [ticketId]);
  } catch (error) {
    throw error;
  }
}

module.exports = {
  createTicket,
  listTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
};
