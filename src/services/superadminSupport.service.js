const { pool, getTenantPool } = require('../config/db');

/**
 * Superadmin Support Service
 * Handles all support ticket operations for superadmin (across all tenants)
 */

/**
 * Get all support tickets from all tenants
 * @param {Object} filter - Filter options { status, priority, category, searchTerm }
 * @param {Object} pagination - Pagination { limit, offset }
 * @returns {Promise<Array>} Array of tickets with tenant info
 */
async function getAllTickets(filter = {}, pagination = { limit: 10, offset: 0 }) {
  try {
    const { status, priority, category, searchTerm } = filter;
    const { limit, offset } = pagination;

    let query = `
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
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND st.status = $${paramCount++}`;
      params.push(status);
    }

    if (priority) {
      query += ` AND st.priority = $${paramCount++}`;
      params.push(priority);
    }

    if (category) {
      query += ` AND st.category = $${paramCount++}`;
      params.push(category);
    }

    if (searchTerm) {
      query += ` AND (
        CAST(st.id AS TEXT) LIKE $${paramCount} 
        OR st.subject ILIKE $${paramCount}
        OR st.admin_name ILIKE $${paramCount}
        OR st.tenant_name ILIKE $${paramCount}
      )`;
      params.push(`%${searchTerm}%`);
      paramCount++;
    }

    query += ` GROUP BY st.id ORDER BY st.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all support tickets:', error);
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
    const { status, priority, category, searchTerm } = filter;

    let query = `
      SELECT COUNT(DISTINCT st.id) as total
      FROM support_tickets st
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND st.status = $${paramCount++}`;
      params.push(status);
    }

    if (priority) {
      query += ` AND st.priority = $${paramCount++}`;
      params.push(priority);
    }

    if (category) {
      query += ` AND st.category = $${paramCount++}`;
      params.push(category);
    }

    if (searchTerm) {
      query += ` AND (
        CAST(st.id AS TEXT) LIKE $${paramCount} 
        OR st.subject ILIKE $${paramCount}
        OR st.admin_name ILIKE $${paramCount}
        OR st.tenant_name ILIKE $${paramCount}
      )`;
      params.push(`%${searchTerm}%`);
      paramCount++;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total) || 0;
  } catch (error) {
    console.error('Error getting support tickets count:', error);
    throw error;
  }
}

/**
 * Get statistics for all tickets across all tenants
 * @returns {Promise<Object>} Stats { total, open, inProgress, resolved, closed }
 */
async function getTicketStats() {
  try {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Open' THEN 1 END) as open,
        COUNT(CASE WHEN status = 'In Progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'Resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN status = 'Closed' THEN 1 END) as closed
      FROM support_tickets
    `;

    const result = await pool.query(query);
    const row = result.rows[0];
    return {
      total: parseInt(row.total) || 0,
      open: parseInt(row.open) || 0,
      inProgress: parseInt(row.in_progress) || 0,
      resolved: parseInt(row.resolved) || 0,
      closed: parseInt(row.closed) || 0,
    };
  } catch (error) {
    console.error('Error getting ticket stats:', error);
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
      WHERE st.id = $1
    `;

    const ticketResult = await pool.query(ticketQuery, [ticketId]);
    if (!ticketResult.rows[0]) {
      return null;
    }

    const ticket = ticketResult.rows[0];

    // Fetch replies for this ticket
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

    const repliesResult = await pool.query(repliesQuery, [ticketId]);

    return {
      ...ticket,
      replies: repliesResult.rows || [],
    };
  } catch (error) {
    console.error('Error fetching ticket by ID:', error);
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

    let updateQuery = `
      UPDATE support_tickets
      SET 
        status = $1,
        updated_at = CURRENT_TIMESTAMP
    `;

    const params = [newStatus, ticketId];
    let paramCount = 3;

    // Set resolved_at when status becomes Resolved
    if (newStatus === 'Resolved') {
      updateQuery += `, resolved_at = CASE WHEN resolved_at IS NULL THEN CURRENT_TIMESTAMP ELSE resolved_at END`;
    }

    // Set closed_at when status becomes Closed
    if (newStatus === 'Closed') {
      updateQuery += `, closed_at = CASE WHEN closed_at IS NULL THEN CURRENT_TIMESTAMP ELSE closed_at END`;
    }

    updateQuery += ` WHERE id = $2 RETURNING *`;

    const result = await pool.query(updateQuery, params);
    return result.rows[0];
  } catch (error) {
    console.error('Error updating ticket status:', error);
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

    const query = `
      INSERT INTO support_ticket_replies 
      (ticket_id, superadmin_id, message, internal_notes, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const params = [ticketId, superadminId, message.trim(), internalNotes || null];
    const result = await pool.query(query, params);

    // Also update the ticket's updated_at timestamp
    await pool.query(
      'UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [ticketId]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error adding reply:', error);
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
    console.error('Error fetching replies:', error);
    throw error;
  }
}

module.exports = {
  getAllTickets,
  getTicketsCount,
  getTicketStats,
  getTicketById,
  updateTicketStatus,
  addReply,
  getRepliesByTicketId,
};
