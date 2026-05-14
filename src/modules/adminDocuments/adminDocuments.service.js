'use strict';

const repo = require('./adminDocuments.repository');
const ApiError = require('../../utils/ApiError');
const { getTenantPool } = require('../../../src/config/db');

exports.listAllDocuments = async (dbName) => {
  const pool = await getTenantPool(dbName);
  const documents = await repo.findAllDocuments(pool);
  return { documents };
};

exports.updateStatus = async (dbName, id, { status, rejection_reason, actorId, actorName }) => {
  const pool = await getTenantPool(dbName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if document exists
    const doc = await repo.findDocumentById(client, id);
    if (!doc) {
      throw ApiError.notFound('Document not found');
    }

    const updated = await repo.updateDocumentStatus(client, id, { status, rejection_reason, actorId });

    // Insert audit log
    await repo.insertAudit(client, {
      document_id: id,
      action: status === 'Approved' ? 'Approved' : 'Rejected',
      actor_id: actorId,
      actor_name: actorName,
      detail: rejection_reason || 'Status updated',
    });

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
