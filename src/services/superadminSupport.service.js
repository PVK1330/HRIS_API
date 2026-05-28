const { pool, getTenantPool } = require('../config/db');

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
      WHERE 1=1 ${filterClause}
      GROUP BY st.id
      ORDER BY st.created_at DESC
    `;

    await Promise.all(tenants.map(async (tenant) => {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const result = await tenantPool.query(ticketQuery, params);
        allRows.push(...result.rows.map((row) => ({ ...row, tenant_db: tenant.db_name })));
      } catch (err) {
        console.error(`Failed to fetch support tickets for tenant ${tenant.db_name}:`, err.message);
      }
    }));

    const sortedRows = allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sortedRows.slice(pagination.offset, pagination.offset + pagination.limit);
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
    const tenants = await getAllTenants();
    const { filterClause, params } = buildTicketFilters(filter);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM support_tickets st
      WHERE 1=1 ${filterClause}
    `;

    const counts = await Promise.all(tenants.map(async (tenant) => {
      try {
        const tenantPool = getTenantPool(tenant.db_name);
        const result = await tenantPool.query(countQuery, params);
        return parseInt(result.rows[0].total, 10) || 0;
      } catch (err) {
        console.error(`Failed to count support tickets for tenant ${tenant.db_name}:`, err.message);
        return 0;
      }
    }));

    return counts.reduce((sum, current) => sum + current, 0);
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
        `;
        const result = await tenantPool.query(query);
        return result.rows[0] || {};
      } catch (err) {
        console.error(`Failed to fetch ticket stats for tenant ${tenant.db_name}:`, err.message);
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
          WHERE st.id = $1
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
        console.error(`Failed to fetch ticket ${ticketId} from tenant ${tenant.db_name}:`, err.message);
      }
    }

    return null;
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
          return result.rows[0];
        }
      } catch (err) {
        console.error(`Failed to update ticket status for tenant ${tenant.db_name}:`, err.message);
      }
    }

    throw new Error('Support ticket not found');
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

    return result.rows[0];
  } catch (error) {
    console.error('Error adding reply:', error);
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
          return result.rows[0];
        }
      } catch (err) {
        console.error(`Failed to update ticket for tenant ${tenant.db_name}:`, err.message);
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

        // Delete replies first (tenant-level)
        await tenantPool.query('DELETE FROM support_ticket_replies WHERE ticket_id = $1', [ticketId]);

        const delResult = await tenantPool.query('DELETE FROM support_tickets WHERE id = $1 RETURNING *', [ticketId]);
        if (delResult.rows.length) {
          return delResult.rows[0];
        }
      } catch (err) {
        console.error(`Failed to delete ticket for tenant ${tenant.db_name}:`, err.message);
      }
    }

    return null;
  } catch (error) {
    console.error('Error deleting ticket:', error);
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
  updateTicket,
  updateTicketStatus,
  addReply,
  deleteTicket,
  getRepliesByTicketId,
};
