const { pool, getTenantPool } = require('../config/db');
const { sendMail } = require('../utils/mail');

/**
 * Superadmin Support Service
 * Handles all support ticket operations for superadmin (across all tenants)
 */

async function getAllTenants() {
  const result = await pool.query(
    `SELECT id, name as tenant_name, db_name FROM public.tenants ORDER BY id ASC`
  );
  return result.rows || [];
}

function buildTicketFilters(filter = {}) {
  const conditions = [];
  const params = [];
  let paramCount = 1;

  if (filter.status) {
    conditions.push(`st.status = $${paramCount++}`);
    params.push(filter.status);
  }

  if (filter.priority) {
    conditions.push(`st.priority = $${paramCount++}`);
    params.push(filter.priority);
  }

  if (filter.category) {
    conditions.push(`st.category = $${paramCount++}`);
    params.push(filter.category);
  }

  if (filter.searchTerm) {
    conditions.push(`(
        CAST(st.id AS TEXT) LIKE $${paramCount}
        OR st.subject ILIKE $${paramCount}
        OR st.admin_name ILIKE $${paramCount}
        OR st.tenant_name ILIKE $${paramCount}
      )`);
    params.push(`%${filter.searchTerm}%`);
    paramCount++;
  }

  return {
    filterClause: conditions.length ? `AND ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Get all support tickets from all tenants
 * @param {Object} filter - Filter options { status, priority, category, searchTerm }
 * @param {Object} pagination - Pagination { limit, offset }
 * @returns {Promise<Array>} Array of tickets with tenant info
 */
async function getAllTickets(filter = {}, pagination = { limit: 10, offset: 0 }) {
  try {
    const tenants = await getAllTenants();
    const allRows = [];
    const { filterClause, params } = buildTicketFilters(filter);

    const ticketQuery = `
      SELECT 
        st.id,
        st.admin_id,
        st.admin_name,
        st.tenant_id,
        st.tenant_name,
        st.subject,
        st.category,
        st.priority,
        st.description,
        st.attachment_url,
        st.status,
        st.created_at,
        st.updated_at,
        st.resolved_at,
        st.closed_at,
        COUNT(str.id) as reply_count
      FROM support_tickets st
      LEFT JOIN support_ticket_replies str ON st.id = str.ticket_id
      WHERE 1=1 AND st.superadmin_deleted = false ${filterClause}
      GROUP BY st.id
      ORDER BY st.created_at DESC
    `;

    await Promise.all(tenants.map(async (tenant) => {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const result = await tenantPool.query(ticketQuery, params);
        allRows.push(...result.rows.map((row) => ({ ...row, tenant_db: tenant.db_name })));
      } catch (err) {
        // Silent fail to continue with other tenants
      }
    }));

    const sortedRows = allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sortedRows.slice(pagination.offset, pagination.offset + pagination.limit);
  } catch (error) {
    throw error;
  }
}

/**
 * Get total count of all support tickets (for pagination)
 * @param {Object} filter - Filter options { status, priority, category, searchTerm }
 * @returns {Promise<number>} Total count
 */
async function getTicketsCount(filter = {}) {
  try {
    const tenants = await getAllTenants();
    const { filterClause, params } = buildTicketFilters(filter);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM support_tickets st
      WHERE st.superadmin_deleted = false ${filterClause}
    `;

    const counts = await Promise.all(tenants.map(async (tenant) => {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const result = await tenantPool.query(countQuery, params);
        return parseInt(result.rows[0].total, 10) || 0;
      } catch (err) {
        return 0;
      }
    }));

    return counts.reduce((sum, current) => sum + current, 0);
  } catch (error) {
    throw error;
  }
}

/**
 * Get statistics for all tickets across all tenants
 * @returns {Promise<Object>} Stats { total, open, inProgress, resolved, closed }
 */
async function getTicketStats() {
  try {
    const tenants = await getAllTenants();
    const stats = await Promise.all(tenants.map(async (tenant) => {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const query = `
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'Open' THEN 1 END) as open,
            COUNT(CASE WHEN status = 'In Progress' THEN 1 END) as in_progress,
            COUNT(CASE WHEN status = 'Resolved' THEN 1 END) as resolved,
            COUNT(CASE WHEN status = 'Closed' THEN 1 END) as closed
          FROM support_tickets
          WHERE superadmin_deleted = false
        `;
        const result = await tenantPool.query(query);
        return result.rows[0] || {};
      } catch (err) {
        return { total: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 };
      }
    }));

    return stats.reduce(
      (acc, row) => ({
        total: acc.total + parseInt(row.total || 0, 10),
        open: acc.open + parseInt(row.open || 0, 10),
        inProgress: acc.inProgress + parseInt(row.in_progress || 0, 10),
        resolved: acc.resolved + parseInt(row.resolved || 0, 10),
        closed: acc.closed + parseInt(row.closed || 0, 10),
      }),
      { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 }
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Get single ticket details by ID (across all tenants)
 * @param {number} ticketId - The ticket ID
 * @returns {Promise<Object>} Ticket details with replies
 */
async function getTicketById(ticketId) {
  try {
    const tenants = await getAllTenants();

    for (const tenant of tenants) {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const ticketQuery = `
          SELECT 
            st.id,
            st.admin_id,
            st.admin_name,
            st.tenant_id,
            st.tenant_name,
            st.subject,
            st.category,
            st.priority,
            st.description,
            st.attachment_url,
            st.status,
            st.created_at,
            st.updated_at,
            st.resolved_at,
            st.closed_at
          FROM support_tickets st
          WHERE st.id = $1 AND st.superadmin_deleted = false
          LIMIT 1
        `;

        const ticketResult = await tenantPool.query(ticketQuery, [ticketId]);
        if (!ticketResult.rows[0]) continue;

        const ticket = ticketResult.rows[0];
        const repliesQuery = `
          SELECT 
            id,
            ticket_id,
            superadmin_id,
            message,
            internal_notes,
            created_at
          FROM support_ticket_replies
          WHERE ticket_id = $1
          ORDER BY created_at ASC
        `;

        const repliesResult = await tenantPool.query(repliesQuery, [ticketId]);

        return {
          ...ticket,
          dbName: tenant.db_name,
          replies: repliesResult.rows || [],
        };
      } catch (err) {
        // Continue to next tenant
      }
    }

    return null;
  } catch (error) {
    throw error;
  }
}

/**
 * Update ticket status
 * @param {number} ticketId - The ticket ID
 * @param {string} newStatus - New status (Open, In Progress, Resolved, Closed)
 * @returns {Promise<Object>} Updated ticket
 */
async function updateTicketStatus(ticketId, newStatus) {
  try {
    const validStatuses = ['Open', 'In Progress', 'Resolved', 'Closed'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const tenants = await getAllTenants();
    for (const tenant of tenants) {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        let updateQuery = `
          UPDATE support_tickets
          SET 
            status = $1,
            updated_at = CURRENT_TIMESTAMP
        `;
        const params = [newStatus, ticketId];

        if (newStatus === 'Resolved') {
          updateQuery += `, resolved_at = CASE WHEN resolved_at IS NULL THEN CURRENT_TIMESTAMP ELSE resolved_at END`;
        }

        if (newStatus === 'Closed') {
          updateQuery += `, closed_at = CASE WHEN closed_at IS NULL THEN CURRENT_TIMESTAMP ELSE closed_at END`;
        }

        updateQuery += ` WHERE id = $2 RETURNING *`;
        const result = await tenantPool.query(updateQuery, params);
        if (result.rows.length) {
          // Include dbName for tenant reference
          return { ...result.rows[0], dbName: tenant.db_name };
        }
      } catch (err) {
        // Continue with next tenant
      }
    }

    throw new Error('Support ticket not found');
  } catch (error) {
    throw error;
  }
}

/**
 * Add a reply/response to a support ticket
 * @param {number} ticketId - The ticket ID
 * @param {number} superadminId - The superadmin ID
 * @param {string} message - The response message
 * @param {string} internalNotes - Internal notes (optional)
 * @returns {Promise<Object>} Created reply
 */
async function addReply(ticketId, superadminId, message, internalNotes = null) {
  try {
    if (!message || !message.trim()) {
      throw new Error('Reply message is required');
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket || !ticket.dbName) {
      throw new Error('Support ticket not found');
    }

    const tenantPool = getTenantPool(ticket.dbName);
    const query = `
      INSERT INTO support_ticket_replies 
      (ticket_id, superadmin_id, message, internal_notes, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const params = [ticketId, superadminId, message.trim(), internalNotes || null];
    const result = await tenantPool.query(query, params);

    await tenantPool.query(
      'UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [ticketId]
    );

    const reply = result.rows[0];

    // Send email to admin about superadmin response (non-blocking)
    try {
      const ticketIdFormatted = `TKT-${String(ticketId).padStart(3, '0')}`;
      
      let adminEmail = null;
      let adminName = ticket.admin_name || 'Admin';

      if (ticket.admin_id && ticket.dbName) {
        try {
          const adminResult = await tenantPool.query(
            `SELECT u.id, u.username, u.name, u.email, u.role
             FROM users u
             WHERE u.id = $1 LIMIT 1`,
            [ticket.admin_id]
          );
          
          if (adminResult.rows[0]) {
            const admin = adminResult.rows[0];
            const rawEmail = admin.email || admin.username;
            if (rawEmail) {
              const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
              if (isEmailValid) {
                adminEmail = rawEmail;
                adminName = admin.name || adminName;
                console.log(`[Support Ticket] Selected admin recipient email: ${adminEmail}`);
              } else {
                console.warn(`[Support Ticket] Warning: Admin identifier '${rawEmail}' is not a valid email.`);
              }
            }
          }
        } catch (err) {
          console.error('Error fetching admin email:', err);
        }
      }

      if (!adminEmail) {
        console.warn('[Support Ticket] Warning: No valid admin email found. Skipping email notification.');
      }

      if (adminEmail) {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb;">
            <div style="background-color: #0F766E; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0;">Ticket Updated</h1>
            </div>
            <div style="padding: 20px; background-color: #ffffff; border-radius: 0 0 8px 8px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hello ${ticket.admin_name || 'Admin'},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your support ticket has been updated by the Superadmin.</p>
              
              <h2 style="color: #1F2937; font-size: 18px; margin-top: 24px; margin-bottom: 12px;">Ticket Details</h2>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937; width: 40%;">Ticket ID:</td>
                  <td style="padding: 12px; color: #374151;">${ticketIdFormatted}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937;">Subject:</td>
                  <td style="padding: 12px; color: #374151;">${ticket.subject}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937;">Category:</td>
                  <td style="padding: 12px; color: #374151;">${ticket.category}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937;">Priority:</td>
                  <td style="padding: 12px; color: #374151;"><span style="background-color: ${ticket.priority === 'High' ? '#FEE2E2' : ticket.priority === 'Medium' ? '#FEF3C7' : '#DBEAFE'}; padding: 4px 8px; border-radius: 4px; color: ${ticket.priority === 'High' ? '#DC2626' : ticket.priority === 'Medium' ? '#D97706' : '#2563EB'}; font-weight: bold;">${ticket.priority}</span></td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937;">Current Status:</td>
                  <td style="padding: 12px; color: #374151;">${ticket.status}</td>
                </tr>
              </table>
              
              <h2 style="color: #1F2937; font-size: 18px; margin-top: 24px; margin-bottom: 12px;">Superadmin Response</h2>
              <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
                <p style="color: #374151; margin: 0; line-height: 1.6; white-space: pre-wrap;">${message.trim()}</p>
              </div>
              
              <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: bold; color: #1F2937; width: 40%;">Created At:</td>
                  <td style="padding: 12px; color: #374151;">${ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; font-weight: bold; color: #1F2937;">Updated At:</td>
                  <td style="padding: 12px; color: #374151;">${ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : 'N/A'}</td>
                </tr>
              </table>
              
              <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
                <p style="color: #374151; margin: 0; line-height: 1.6;">
                  Please login to the <strong>HRMS Portal</strong> to view complete ticket details and conversation history.
                </p>
              </div>
              
              <p style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 24px;">
                Regards,<br/>
                <strong>HRMS Support Team</strong>
              </p>
            </div>
          </div>
        `;

        const emailText = `
Hello ${ticket.admin_name || 'Admin'},

Your support ticket has been updated by the Superadmin.

Ticket Details:
- Ticket ID: ${ticketIdFormatted}
- Subject: ${ticket.subject}
- Category: ${ticket.category}
- Priority: ${ticket.priority}
- Current Status: ${ticket.status}

Superadmin Response:
${message.trim()}

- Created At: ${ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'N/A'}
- Updated At: ${ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : 'N/A'}

Please login to the HRMS Portal to view complete ticket details and conversation history.

Regards,
HRMS Support Team
        `;

        await sendMail({
          to: adminEmail,
          subject: `Support Ticket Updated - ${ticketIdFormatted}`,
          html: emailHtml,
          text: emailText,
        });

      } else {
        // No admin email available
      }
    } catch (error) {
      // Email sending should not break reply creation
    }

    return reply;
  } catch (error) {
    throw error;
  }
}

async function updateTicket(ticketId, updates = {}) {
  try {
    const { status, assignedTo, superAdminDescription } = updates;
    const validStatuses = ['Open', 'In Progress', 'Waiting for Admin', 'Resolved', 'Closed'];

    if (status && !validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const tenants = await getAllTenants();
    let updatedTicket = null;
    
    for (const tenant of tenants) {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const fields = ['updated_at = CURRENT_TIMESTAMP'];
        const params = [];

        if (status != null) {
          fields.push(`status = $${params.length + 1}`);
          params.push(status);
        }

        if (assignedTo != null) {
          fields.push(`assigned_to = $${params.length + 1}`);
          params.push(assignedTo);
        }

        if (superAdminDescription != null) {
          fields.push(`super_admin_description = $${params.length + 1}`);
          params.push(superAdminDescription);
        }

        if (status === 'Resolved') {
          fields.push(`resolved_at = CASE WHEN resolved_at IS NULL THEN CURRENT_TIMESTAMP ELSE resolved_at END`);
        }

        if (status === 'Closed') {
          fields.push(`closed_at = CASE WHEN closed_at IS NULL THEN CURRENT_TIMESTAMP ELSE closed_at END`);
        }

        if (fields.length === 1) {
          continue;
        }

        const query = `
          UPDATE support_tickets
          SET ${fields.join(', ')}
          WHERE id = $${params.length + 1}
          RETURNING *
        `;

        const result = await tenantPool.query(query, [...params, ticketId]);
        if (result.rows.length) {
          updatedTicket = { ...result.rows[0], dbName: tenant.db_name };
          
          // Send email to admin about status/description update (non-blocking)
          try {
            const ticketIdFormatted = `TKT-${String(ticketId).padStart(3, '0')}`;
            
            // Get admin_id from updated ticket
            const adminId = updatedTicket?.admin_id;
            
            let adminEmail = null;
            let adminName = updatedTicket?.admin_name || 'Admin';

            if (adminId && tenant.db_name) {
              try {
                const adminResult = await tenantPool.query(
                  `SELECT u.id, u.username, u.name, u.email, u.role
                   FROM users u
                   WHERE u.id = $1 LIMIT 1`,
                  [adminId]
                );
                
                if (adminResult.rows[0]) {
                  const admin = adminResult.rows[0];
                  const rawEmail = admin.email || admin.username;
                  if (rawEmail) {
                    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
                    if (isEmailValid) {
                      adminEmail = rawEmail;
                      adminName = admin.name || adminName;
                      console.log(`[Support Ticket] Selected admin recipient email: ${adminEmail}`);
                    } else {
                      console.warn(`[Support Ticket] Warning: Admin identifier '${rawEmail}' is not a valid email.`);
                    }
                  }
                }
              } catch (err) {
                console.error('Error fetching admin email:', err);
              }
            }

            if (!adminEmail) {
              console.warn('[Support Ticket] Warning: No valid admin email found. Skipping email notification.');
            }

            if (adminEmail) {
                
                

                const emailHtml = `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb;">
                    <div style="background-color: #0F766E; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                      <h1 style="margin: 0;">Support Ticket Updated</h1>
                    </div>
                    <div style="padding: 20px; background-color: #ffffff; border-radius: 0 0 8px 8px;">
                      <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hello ${adminName || updatedTicket.admin_name || 'Admin'},</p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your support ticket has been updated by the Superadmin.</p>
                      
                      <h2 style="color: #1F2937; font-size: 18px; margin-top: 24px; margin-bottom: 12px;">Ticket Details</h2>
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937; width: 40%;">Ticket ID:</td>
                          <td style="padding: 12px; color: #374151;">${ticketIdFormatted}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937;">Subject:</td>
                          <td style="padding: 12px; color: #374151;">${updatedTicket.subject}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937;">Category:</td>
                          <td style="padding: 12px; color: #374151;">${updatedTicket.category}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937;">Priority:</td>
                          <td style="padding: 12px; color: #374151;"><span style="background-color: ${updatedTicket.priority === 'High' ? '#FEE2E2' : updatedTicket.priority === 'Medium' ? '#FEF3C7' : '#DBEAFE'}; padding: 4px 8px; border-radius: 4px; color: ${updatedTicket.priority === 'High' ? '#DC2626' : updatedTicket.priority === 'Medium' ? '#D97706' : '#2563EB'}; font-weight: bold;">${updatedTicket.priority}</span></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937;">Current Status:</td>
                          <td style="padding: 12px; color: #374151;"><strong>${updatedTicket.status}</strong></td>
                        </tr>
                      </table>
                      
                      ${superAdminDescription ? `
                      <h2 style="color: #1F2937; font-size: 18px; margin-top: 24px; margin-bottom: 12px;">Superadmin Response</h2>
                      <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #374151; margin: 0; line-height: 1.6; white-space: pre-wrap;">${superAdminDescription}</p>
                      </div>
                      ` : ''}
                      
                      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                          <td style="padding: 12px; font-weight: bold; color: #1F2937; width: 40%;">Created At:</td>
                          <td style="padding: 12px; color: #374151;">${updatedTicket.created_at ? new Date(updatedTicket.created_at).toLocaleString() : 'N/A'}</td>
                        </tr>
                        <tr>
                          <td style="padding: 12px; font-weight: bold; color: #1F2937;">Updated At:</td>
                          <td style="padding: 12px; color: #374151;">${updatedTicket.updated_at ? new Date(updatedTicket.updated_at).toLocaleString() : 'N/A'}</td>
                        </tr>
                      </table>
                      
                      <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #374151; margin: 0; line-height: 1.6;">
                          Please login to the <strong>HRMS Portal</strong> to view complete ticket details and conversation history.
                        </p>
                      </div>
                      
                      <p style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 24px;">
                        Regards,<br/>
                        <strong>HRMS Support Team</strong>
                      </p>
                    </div>
                  </div>
                `;

                const emailText = `
Hello ${adminName || updatedTicket.admin_name || 'Admin'},

Your support ticket has been updated by the Superadmin.

Ticket Details:
- Ticket ID: ${ticketIdFormatted}
- Subject: ${updatedTicket.subject}
- Category: ${updatedTicket.category}
- Priority: ${updatedTicket.priority}
- Current Status: ${updatedTicket.status}

${superAdminDescription ? `Superadmin Response:\n${superAdminDescription}\n` : ''}

- Created At: ${updatedTicket.created_at ? new Date(updatedTicket.created_at).toLocaleString() : 'N/A'}
- Updated At: ${updatedTicket.updated_at ? new Date(updatedTicket.updated_at).toLocaleString() : 'N/A'}

Please login to the HRMS Portal to view complete ticket details and conversation history.

Regards,
HRMS Support Team
                `;

                await sendMail({
                  to: adminEmail,
                  subject: `Support Ticket Updated - ${ticketIdFormatted}`,
                  html: emailHtml,
                  text: emailText,
                });
                
                
              } else {
                
              }
          } catch (emailError) {
            
            // Email sending should not break ticket update
          }
          
          return updatedTicket;
        }
      } catch (err) {
        // Continue with next tenant
      }
    }

    return null;
  } catch (error) {
    console.error('Error updating ticket:', error);
    throw error;
  }
}

/**
 * Delete a ticket and its replies across tenants
 * @param {number} ticketId
 * @returns {Promise<Object|null>} deleted ticket row or null
 */
async function deleteTicket(ticketId) {
  try {
    const tenants = await getAllTenants();
    for (const tenant of tenants) {
      try {
        const tenantPool = getTenantPool(tenant.db_name);

        // Soft delete for superadmin - only mark superadmin_deleted
        const delResult = await tenantPool.query(
          `UPDATE support_tickets 
           SET superadmin_deleted = true, superadmin_deleted_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [ticketId]
        );

        if (delResult.rows.length) {
          const ticket = delResult.rows[0];

          // Check if both sides deleted - then hard delete
          if (ticket.admin_deleted && ticket.superadmin_deleted) {
            await hardDeleteTicketCompletely(tenantPool, ticketId);
          }

          return ticket;
        }
      } catch (err) {
        // Continue with next tenant
      }
    }

    return null;
  } catch (error) {
    throw error;
  }
}

async function hardDeleteTicketCompletely(pool, ticketId) {
  try {
    // Delete ticket replies/conversation history
    await pool.query('DELETE FROM support_ticket_replies WHERE ticket_id = $1', [ticketId]);

    // Delete notifications related to ticket
    await pool.query('DELETE FROM notifications WHERE ticket_id = $1', [ticketId]);

    // Delete ticket attachments (if stored separately)
    await pool.query('DELETE FROM support_ticket_attachments WHERE ticket_id = $1', [ticketId]);

    // Hard delete the ticket
    await pool.query('DELETE FROM support_tickets WHERE id = $1', [ticketId]);
  } catch (error) {
    throw error;
  }
}

/**
 * Get all replies for a ticket
 * @param {number} ticketId - The ticket ID
 * @returns {Promise<Array>} Array of replies
 */
async function getRepliesByTicketId(ticketId) {
  try {
    const query = `
      SELECT 
        id,
        ticket_id,
        superadmin_id,
        message,
        internal_notes,
        created_at
      FROM support_ticket_replies
      WHERE ticket_id = $1
      ORDER BY created_at ASC
    `;

    const result = await pool.query(query, [ticketId]);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getAllTickets,
  getTicketsCount,
  getTicketStats,
  getTicketById,
  updateTicket,
  updateTicketStatus,
  addReply,
  deleteTicket,
  getRepliesByTicketId,
};
