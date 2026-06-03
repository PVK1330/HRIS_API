'use strict';

const crypto = require('crypto');

function buildHash({
  notificationType,
  entityType,
  entityId,
  recipientId,
  sentVia,
  title,
}) {
  const payload = JSON.stringify({
    notificationType,
    entityType,
    entityId: String(entityId),
    recipientId: recipientId == null ? '' : String(recipientId),
    sentVia,
    title: title || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function wasAlreadySent(pool, hash) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_history WHERE hash = $1 LIMIT 1`,
    [hash],
  );
  return rows.length > 0;
}

async function recordSent(pool, {
  tenantId,
  notificationType,
  entityType,
  entityId,
  recipientId,
  sentVia,
  hash,
}) {
  await pool.query(
    `INSERT INTO notification_history
       (tenant_id, notification_type, entity_type, entity_id, recipient_id, sent_via, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (hash) DO NOTHING`,
    [
      tenantId || null,
      notificationType,
      entityType,
      String(entityId),
      recipientId || null,
      sentVia,
      hash,
    ],
  );
}

module.exports = {
  buildHash,
  wasAlreadySent,
  recordSent,
};
